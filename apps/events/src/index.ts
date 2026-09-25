type ProviderEventMessage = {
  event: { id: string; provider: string; type: string; subjectReference?: string; providerObjectId: string; createdAt: string; data: Record<string, unknown> };
  receivedAt: string;
  payloadSha256: string;
};

import { applyProviderEvent } from "@aurel/provider-projections";
import { checkDependencies, recordDeadLetter, runScheduledReconciliation } from "./reconciliation";

async function processMessage(env: Cloudflare.Env, message: Message<ProviderEventMessage>): Promise<void> {
  const { event } = message.body;
  // Apply first: a failure here is retried and never marks the receipt processed.
  const result = await applyProviderEvent(env.PROJECTION_DB, event);
  const subjectReference = event.subjectReference ?? `unresolved:${event.providerObjectId}`;
  const now = new Date().toISOString();
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`
      INSERT OR IGNORE INTO projection_refreshes
      (refresh_id, event_id, subject_reference, source_name, source_external_id, requested_at, completed_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
    `).bind(crypto.randomUUID(), event.id, subjectReference, event.provider, event.providerObjectId, now, now),
    env.PROJECTION_DB.prepare("UPDATE webhook_receipts SET processing_status = 'processed', processed_at = ?, last_error = NULL WHERE event_id = ?")
      .bind(now, event.id)
  ]);
  console.log(JSON.stringify({ message: "provider event processed", queueMessageId: message.id, eventId: event.id, provider: event.provider,
    eventType: event.type, attempt: message.attempts, projection: result }));
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ status: "ok", service: "aurel-provider-event-consumer", financialDataAuthority: "providers-and-chains" });
  },
  async queue(batch, env): Promise<void> {
    if (batch.queue.endsWith("-provider-events-dlq")) {
      for (const message of batch.messages) {
        try {
          await recordDeadLetter(env.PROJECTION_DB, message);
          console.error(JSON.stringify({ level: "critical", event: "provider_event.dead_letter", queueMessageId: message.id, attempts: message.attempts }));
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ level: "error", event: "provider_event.dead_letter_record_failed", queueMessageId: message.id, message: error instanceof Error ? error.message : "unknown" }));
          message.retry({ delaySeconds: 300 });
        }
      }
      return;
    }
    for (const message of batch.messages) {
      try {
        await processMessage(env, message);
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (message.attempts >= 5) {
          await env.PROJECTION_DB.prepare("UPDATE webhook_receipts SET processing_status = 'failed', last_error = ? WHERE event_id = ?")
            .bind(errorMessage.slice(0, 500), message.body.event.id).run();
        }
        console.error(JSON.stringify({ message: "provider event processing failed", queueMessageId: message.id, attempt: message.attempts, error: errorMessage }));
        message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
      }
    }
  },
  async scheduled(controller, env): Promise<void> {
    try {
      const [details, dependencies] = await Promise.all([
        runScheduledReconciliation(env.PROJECTION_DB, controller.scheduledTime),
        checkDependencies(env.PROJECTION_DB, new Date(controller.scheduledTime))
      ]);
      console.log(JSON.stringify({ level: "info", event: "operations.reconciliation.completed", scheduledTime: controller.scheduledTime, ...details, dependencies }));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "operations.reconciliation.failed", scheduledTime: controller.scheduledTime, message: error instanceof Error ? error.message : "unknown" }));
      throw error;
    }
  }
} satisfies ExportedHandler<Cloudflare.Env, ProviderEventMessage>;
