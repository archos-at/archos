import { sign, testKey, type TestKey } from './hostile'

// An Exchange Online inbox rule's redirect: X-MS-Exchange-Inbox-Rules-Loop and no Auto-Submitted
// (Exchange Team blog, "Loop prevention in Exchange Online demystified", 2021-05-03).
// The rest of the hop and what it does to the verdict: docs/architecture/inbound-mail.md.
export const OFFICE_PROJECT_MAILBOX = 'projekt-kienberg@buero-muster.at'
export const TENANT_DOMAIN = 'buermuster.onmicrosoft.com'
export const SRS_ENVELOPE = `bounces+SRS=k3b2Z=QZ@${TENANT_DOMAIN}`

const tenantKey = (): TestKey => testKey(1024)

export async function exchangeRedirect(original: string, mailbox = OFFICE_PROJECT_MAILBOX): Promise<string> {
  const hop = [
    `Received: from AM9PR01MB1234.eurprd01.prod.outlook.com (2603:10a6:20b:1::10) by AM0PR01MB5678.eurprd01.prod.outlook.com with HTTPS; Mon, 28 Sep 2026 08:16:02 +0000`,
    `ARC-Seal: i=1; a=rsa-sha256; s=arcselector10001; d=microsoft.com; cv=none; b=QmFzZTY0U2lnbmF0dXJlTm90VmVyaWZpZWQ=`,
    `ARC-Message-Signature: i=1; a=rsa-sha256; c=relaxed/relaxed; d=microsoft.com; s=arcselector10001; h=From:Date:Subject:Message-ID:Content-Type:MIME-Version; bh=YWJj; b=ZGVm`,
    `ARC-Authentication-Results: i=1; mx.microsoft.com 1; spf=pass smtp.mailfrom=buero-muster.at; dmarc=pass action=none header.from=buero-muster.at; dkim=pass header.d=buero-muster.at; arc=none`,
    `X-MS-Exchange-Inbox-Rules-Loop: ${mailbox}`,
    `X-MS-Exchange-CrossTenant-Network-Message-Id: 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f`,
    `X-MS-Exchange-Organization-AuthAs: Internal`,
    `X-MS-Has-Attach:`,
  ].join('\r\n')
  return sign(`${hop}\r\n${original}`, { domain: TENANT_DOMAIN, selector: 'selector1', key: tenantKey() })
}
