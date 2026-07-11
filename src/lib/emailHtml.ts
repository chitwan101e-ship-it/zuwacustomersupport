export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
}

export function renderCustomerNotificationEmailHtml(opts: {
  brandName: string
  title: string
  body: string
  ctaLabel: string
  linkUrl: string
}): string {
  const { brandName, title, body, ctaLabel, linkUrl } = opts
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h1 style="font-size: 24px; color: #1a56e8; margin-bottom: 8px;">${escapeHtml(brandName)}</h1>
      <p style="color: #111; font-size: 16px; font-weight: 600; margin-bottom: 12px;">${escapeHtml(title)}</p>
      <p style="color: #444; margin-bottom: 24px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(body)}</p>
      <p style="margin-bottom: 24px;">
        <a href="${linkUrl}" style="display: inline-block; background: #5b21b6; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 600;">${escapeHtml(ctaLabel)}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #aaa; font-size: 12px;">You received this because you are a member of ${escapeHtml(brandName)} on Relay.</p>
    </div>
  `
}
