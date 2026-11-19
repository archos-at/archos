import * as pulumi from "@pulumi/pulumi";

/** Unset, the website's forms fall back to the visitor's own mail program. */
export interface WebsiteMailConfig {
  smtp?: { user: string; password: pulumi.Output<string> };
  attioApiKey?: pulumi.Output<string>;
}

export function loadWebsiteMail(cfg: pulumi.Config): WebsiteMailConfig {
  const user = cfg.get("websiteSmtpUser")?.trim() ?? "";
  const password = cfg.getSecret("websiteSmtpPassword");
  if ((user === "") !== (password === undefined)) {
    throw new Error(
      "grid-oib:websiteSmtpUser and grid-oib:websiteSmtpPassword go together: the Workspace user the " +
        "website's forms send as, and that user's app password (`pulumi config set --secret`). Set both or neither.",
    );
  }
  return {
    smtp: password === undefined ? undefined : { user, password },
    attioApiKey: cfg.getSecret("attioApiKey"),
  };
}
