import { permanentRedirect } from "next/navigation";
import { docsOrigin } from "@/lib/site/seo";

/** /docs moved to the public docs site for good. */
export default function DocumentationRedirect() {
  permanentRedirect(docsOrigin());
}
