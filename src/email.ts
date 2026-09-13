import nodemailer from "nodemailer";
import type { DraftedStory } from "./draft.js";
import { teamName } from "./teams.js";

export function renderDigestHtml(date: string, stories: DraftedStory[]): string {
  if (stories.length === 0) {
    return `<p>Nothing fit the "hockey gods" lens across today's team subs — genuinely quiet day, or worth a manual look.</p>`;
  }
  const sorted = [...stories].sort((a, b) =>
    teamName(a.team).localeCompare(teamName(b.team)),
  );
  const sections = sorted
    .map(
      (s) => `
      <div style="margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #333;">
        <p style="color:#8fb6e4;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">${teamName(s.team)}</p>
        <p style="margin:0 0 10px;">
          <a href="${s.sourceUrl}" style="color:#f2f0ec;">${escapeHtml(s.sourceTitle)}</a>
        </p>
        <ol style="margin:0;padding-left:20px;color:#f2f0ec;">
          ${s.tweets.map((t) => `<li style="margin-bottom:8px;">${escapeHtml(t)}</li>`).join("")}
        </ol>
      </div>`,
    )
    .join("\n");

  return `
    <div style="background:#0a0a0b;color:#f2f0ec;font-family:-apple-system,sans-serif;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 4px;">HockeyGods — daily drafts</h1>
      <p style="color:#9aa4b2;font-size:13px;margin:0 0 24px;">${date} · ${stories.length} candidate${stories.length === 1 ? "" : "s"}. Pick, edit, post.</p>
      ${sections}
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendDigest(date: string, stories: DraftedStory[]): Promise<void> {
  const user = requireEnv("GMAIL_USER");
  const pass = requireEnv("GMAIL_APP_PASSWORD");
  const to = requireEnv("DIGEST_TO");

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transport.sendMail({
    from: `HockeyGods Drafts <${user}>`,
    to,
    subject: `HockeyGods drafts — ${date} (${stories.length})`,
    html: renderDigestHtml(date, stories),
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} — copy .env.example to .env and fill it in.`);
  return v;
}
