'use client';

import Link from 'next/link';
import { useState } from 'react';

const subjects = ['General question', 'Partnerships', 'Support', 'Media / Press'];

export default function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sent'>('idle');

  return (
    <div className="space-y-8 p-6 sm:p-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#05070f]/90 p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute inset-[-30%] bg-[radial-gradient(circle_at_20%_20%,rgba(33,212,253,0.12),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(245,82,185,0.12),transparent_45%),radial-gradient(circle_at_50%_85%,rgba(110,255,196,0.08),transparent_45%)]" />
        </div>
        <div className="relative z-10 space-y-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.22em] text-white/60">The Comms Hub</p>
            <h1 className="text-3xl font-semibold text-white">Reach the Mochi team</h1>
            <p className="text-sm text-white/70 max-w-2xl">
              A clean, minimalist inbox for product questions, partnerships, and support. We reply fastest to clear notes with your wallet address and screenshots where relevant.
            </p>
          </div>
          <form
            className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_12px_36px_rgba(0,0,0,0.4)] lg:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setStatus('sent');
            }}
          >
            <div className="space-y-1">
              <label htmlFor="name" className="text-sm font-semibold text-white">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-aurora/60"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="email" className="text-sm font-semibold text-white">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-aurora/60"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="subject" className="text-sm font-semibold text-white">
                Subject
              </label>
              <select
                id="subject"
                name="subject"
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-aurora/60"
                defaultValue={subjects[0]}
              >
                {subjects.map((subject) => (
                  <option key={subject}>{subject}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 lg:row-span-2">
              <label htmlFor="message" className="text-sm font-semibold text-white">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={6}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-aurora/60"
                placeholder="Include your wallet address for account questions."
              />
              <p className="text-xs text-white/50">We keep responses concise and focused on your question.</p>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <button type="submit" className="cta-primary" data-tone="sakura">
                Send message
              </button>
              {status === 'sent' && (
                <p className="text-xs text-aurora">
                  Received. We&apos;ll follow up via email. For urgent issues, ping us on X or Telegram below.
                </p>
              )}
            </div>
          </form>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#060a16]/90 p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="absolute inset-[-25%] bg-[radial-gradient(circle_at_15%_20%,rgba(33,212,253,0.12),transparent_45%),radial-gradient(circle_at_85%_15%,rgba(245,82,185,0.12),transparent_45%)]" />
        </div>
        <div className="relative z-10 space-y-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.22em] text-white/60">Socials</p>
            <h2 className="text-2xl font-semibold text-white">Other channels</h2>
            <p className="text-sm text-white/70">Follow along or DM us on your preferred channel. Only trust links from getmochi.fun.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Link
              href="https://x.com/getmochidotfun"
              target="_blank"
              rel="noreferrer"
              className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:-translate-y-1 hover:border-aurora/50 hover:shadow-[0_10px_30px_rgba(33,212,253,0.25)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white">X</span>
                <span className="glass-chip glass-chip--tiny bg-white/10 text-white/70">Announcements</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-white">@getmochidotfun</p>
              <p className="text-xs text-white/60">Product updates and launches.</p>
            </Link>
            <Link
              href="https://t.me/"
              target="_blank"
              rel="noreferrer"
              className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:-translate-y-1 hover:border-aurora/50 hover:shadow-[0_10px_30px_rgba(33,212,253,0.25)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-aurora/10 text-lg font-semibold text-aurora">TG</span>
                <span className="glass-chip glass-chip--tiny bg-white/10 text-white/70">Chat</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-white">Telegram</p>
              <p className="text-xs text-white/60">Official link will be announced on X. Avoid impostors.</p>
            </Link>
            <div className="group rounded-2xl border border-dashed border-white/20 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white/70">D</span>
                <span className="glass-chip glass-chip--tiny bg-white/5 text-white/60">Coming soon</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-white/80">Discord</p>
              <p className="text-xs text-white/60">We will announce the official invite on this page.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
