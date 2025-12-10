import { NextResponse } from 'next/server';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RedemptionAsset = {
  id: string;
  name: string;
  rarity?: string;
  image?: string;
};

type ShippingAddress = {
  fullName: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  email: string;
  phoneCode: string;
  phoneNumber: string;
};

type ContactInfo = {
  method: 'telegram' | 'discord' | 'whatsapp';
  handle: string;
};

const DB_PATH = process.env.REDEMPTION_DB_PATH || path.resolve(process.cwd(), '..', 'mochi.db');
let db: any = null;

const getDb = () => {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.prepare(
      `CREATE TABLE IF NOT EXISTS RedemptionRequest (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        assetDetails TEXT NOT NULL,
        shippingAddress TEXT NOT NULL,
        contactInfo TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
  }
  return db;
};

const sanitizeAssets = (assets: any[]): RedemptionAsset[] =>
  (assets || [])
    .filter((a) => a?.id && a?.name)
    .map((a) => ({
      id: String(a.id),
      name: String(a.name),
      rarity: a.rarity ? String(a.rarity) : undefined,
      image: a.image ? String(a.image) : undefined,
    }));

const validateShipping = (shipping: any): shipping is ShippingAddress => {
  if (!shipping) return false;
  const required = ['fullName', 'address1', 'city', 'state', 'postal', 'country', 'email', 'phoneCode', 'phoneNumber'];
  return required.every((key) => typeof shipping[key] === 'string' && shipping[key].trim().length > 0);
};

const validateContact = (contact: any): contact is ContactInfo => {
  if (!contact) return false;
  const validMethod = ['telegram', 'discord', 'whatsapp'].includes(contact.method);
  return validMethod && typeof contact.handle === 'string' && contact.handle.trim().length > 0;
};

const sendDiscordNotification = async (ticketId: string, wallet: string, assets: RedemptionAsset[], contact: ContactInfo) => {
  const webhook = process.env.DISCORD_ADMIN_WEBHOOK_URL;
  if (!webhook) return;
  const assetSummary =
    assets
      .slice(0, 5)
      .map((a) => `${a.name}${a.rarity ? ` (${a.rarity})` : ''}`)
      .join('\n') || 'Unspecified assets';
  const payload = {
    embeds: [
      {
        title: 'Physical Redemption Request',
        color: 0xffa500,
        fields: [
          { name: 'Ticket', value: ticketId, inline: true },
          { name: 'Wallet', value: wallet, inline: true },
          { name: 'Assets', value: assetSummary },
          { name: 'Contact', value: `${contact.method}: ${contact.handle}` },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
    const assets = sanitizeAssets(body.assets || []);
    const shipping = body.shipping;
    const contact = body.contact;

    if (!walletAddress) {
      return NextResponse.json({ error: 'Missing wallet address' }, { status: 400 });
    }
    if (!assets.length) {
      return NextResponse.json({ error: 'Select at least one NFT to redeem' }, { status: 400 });
    }
    if (!validateShipping(shipping)) {
      return NextResponse.json({ error: 'Invalid or incomplete shipping address' }, { status: 400 });
    }
    if (!validateContact(contact)) {
      return NextResponse.json({ error: 'Invalid contact info' }, { status: 400 });
    }

    const ticketId = `RDM-${Math.floor(100000 + Math.random() * 900000)}`;
    const record = {
      id: ticketId,
      userId: walletAddress,
      assetDetails: JSON.stringify(assets),
      shippingAddress: JSON.stringify(shipping),
      contactInfo: JSON.stringify(contact),
      status: 'PENDING',
    };

    const database = getDb();
    database
      .prepare(
        `INSERT INTO RedemptionRequest (id, userId, assetDetails, shippingAddress, contactInfo, status)
         VALUES (@id, @userId, @assetDetails, @shippingAddress, @contactInfo, @status)`
      )
      .run(record);

    try {
      await sendDiscordNotification(ticketId, walletAddress, assets, contact);
    } catch (notifyErr) {
      console.error('Discord webhook failed', notifyErr);
    }

    return NextResponse.json({ ticketId, status: 'PENDING' }, { status: 201 });
  } catch (err) {
    console.error('Redemption API error', err);
    return NextResponse.json({ error: 'Server error creating redemption request' }, { status: 500 });
  }
}
