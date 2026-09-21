type ProviderEventMessage = {
  event: { id: string; provider: string; type: string; subjectReference?: string; providerObjectId: string; createdAt: string; data: Record<string, unknown> };
  receivedAt: string;
  payloadSha256: string;
};

async function processMessage(env: Cloudflare.Env, message: Message<ProviderEventMessage>): Promise<void> {
  const { event } = message.body;
  const subjectReference = event.subjectReference ?? `unresolved:${event.providerObjectId}`;
  const refreshId = crypto.randomUUID();
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`
      INSERT OR IGNORE INTO projection_refreshes
      (refresh_id, event_id, subject_reference, source_name, source_external_id, requested_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
    `).bind(refreshId, event.id, subjectReference, event.provider, event.providerObjectId, new Date().toISOString()),
    env.PROJECTION_DB.prepare("UPDATE webhook_receipts SET processing_status = 'processed', processed_at = ?, last_error = NULL WHERE event_id = ?")
      .bind(new Date().toISOString(), event.id)
  ]);
  console.log(JSON.stringify({ message: "provider event processed", queueMessageId: message.id, eventId: event.id, provider: event.provider, eventType: event.type, attempt: message.attempts }));
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ status: "ok", service: "aurel-provider-event-consumer", financialDataAuthority: "providers-and-chains" });
  },
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processMessage(env, message);
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ message: "provider event processing failed", queueMessageId: message.id, attempt: message.attempts, error: errorMessage }));
        message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
      }
    }
  }
} satisfies ExportedHandler<Cloudflare.Env, ProviderEventMessage>;
