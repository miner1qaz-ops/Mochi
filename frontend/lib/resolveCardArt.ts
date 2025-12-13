type ResolveCardArtSyncInput = {
  packType?: string | null;
  setCode?: string | null;
  templateId?: number | null;
  imageUrl?: string | null;
  templateImageUrl?: string | null;
};

type ResolveCardArtInput = ResolveCardArtSyncInput & {
  isNft?: boolean | null;
};

const DEFAULT_METADATA_HOST = 'https://getmochi.fun';

const parseLegacyHosts = (raw?: string) =>
  (raw || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

const rewriteLegacyHost = (url: string, metadataHost: string, legacyHosts: string[]) => {
  let out = url;
  const target = metadataHost.replace(/^https?:\/\//, '');
  legacyHosts.forEach((host) => {
    const normalized = host.replace(/^https?:\/\//, '');
    out = out.replace(normalized, target);
  });
  return out;
};

export const normalizeImageUrl = (
  src: string,
  opts: { metadataHost?: string; legacyHosts?: string[] } = {},
) => {
  let url = src;
  if (url.startsWith('ipfs://')) {
    url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }
  const metadataHost = opts.metadataHost || process.env.NEXT_PUBLIC_METADATA_URL || DEFAULT_METADATA_HOST;
  const legacyHosts = opts.legacyHosts || parseLegacyHosts(process.env.NEXT_PUBLIC_LEGACY_METADATA_HOSTS);
  url = rewriteLegacyHost(url, metadataHost, legacyHosts);
  return url;
};

const normalizeMochiLocalPath = (src: string) => {
  const trimmed = src.trim();
  const megMatch = trimmed.match(/^\/img\/packs\/meg_web\/meg_web_(\d+)_hires\.png$/);
  if (megMatch) {
    return `/img/meg_web/meg_web_${Number(megMatch[1])}_hires.png`;
  }
  return trimmed;
};

const isCardBack = (src?: string | null) => {
  if (!src) return true;
  const normalized = src.trim().toLowerCase();
  return normalized.endsWith('/card_back.png') || normalized === 'card_back.png';
};

const normalizePackType = (packType?: string | null) => (packType || '').trim().toLowerCase();

const canonicalSlug = (packType?: string | null, setCode?: string | null): string | null => {
  const raw = normalizePackType(setCode || packType);
  if (!raw) return null;
  if (raw === 'meg_web' || raw === 'mega_evolutions' || raw === 'mega-evolutions') return 'mega-evolutions';
  if (raw === 'phantasmal_flames') return 'phantasmal_flames';
  return raw;
};

const templateIdToPath = (templateId: number) =>
  templateId >= 1000 ? String(templateId) : String(templateId).padStart(3, '0');

const canonicalImageFromIds = (
  templateId: number | null,
  packType?: string | null,
  setCode?: string | null,
) => {
  if (!templateId) return null;
  const slug = canonicalSlug(packType, setCode);
  if (!slug) return null;
  const host = (process.env.NEXT_PUBLIC_METADATA_URL || DEFAULT_METADATA_HOST).replace(/\/$/, '');
  return `${host}/img/${slug}/${templateIdToPath(templateId)}.jpg`;
};

const canonicalMetadataUrl = (
  templateId: number | null,
  packType: string | null | undefined,
  setCode: string | null | undefined,
  metadataHost: string,
) => {
  if (!templateId) return null;
  const slug = canonicalSlug(packType, setCode);
  if (!slug) return null;
  return `${metadataHost.replace(/\/$/, '')}/nft/metadata/${slug}/${templateIdToPath(templateId)}.json`;
};

const extractImageFromMetadata = (meta: any): string | null => {
  if (!meta || typeof meta !== 'object') return null;
  const direct = meta.image || meta.image_url || meta.imageUrl;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const fromProps =
    meta.properties?.image ||
    meta.properties?.files?.[0]?.uri ||
    meta.content?.links?.image ||
    meta.content?.files?.[0]?.uri;
  if (typeof fromProps === 'string' && fromProps.trim()) return fromProps.trim();
  return null;
};

export const resolveCardArtSync = (input: ResolveCardArtSyncInput): string | null => {
  const packKey = normalizePackType(input.packType);
  const setCode = input.setCode || null;
  const templateId = input.templateId ?? null;
  const canonicalFromIds = canonicalImageFromIds(templateId, packKey, setCode);

  if (input.imageUrl && !isCardBack(input.imageUrl)) {
    return normalizeImageUrl(input.imageUrl);
  }

  if (input.templateImageUrl && !isCardBack(input.templateImageUrl)) {
    const normalizedLocal = normalizeMochiLocalPath(input.templateImageUrl);
    if (normalizedLocal.startsWith('/')) return normalizedLocal;
    return normalizeImageUrl(normalizedLocal);
  }

  if (canonicalFromIds && !isCardBack(canonicalFromIds)) {
    return canonicalFromIds;
  }

  return null;
};

export async function resolveCardArt(input: ResolveCardArtInput): Promise<string | null> {
  const sync = resolveCardArtSync(input);
  if (sync) return sync;

  const templateId = input.templateId ?? null;
  if (!templateId) return null;

  const metadataHost = process.env.NEXT_PUBLIC_METADATA_URL || DEFAULT_METADATA_HOST;
  const metadataUrl = canonicalMetadataUrl(templateId, input.packType, input.setCode, metadataHost);
  if (!metadataUrl) return canonicalImageFromIds(templateId, input.packType, input.setCode);

  try {
    const res = await fetch(metadataUrl, { cache: 'no-store' });
    if (!res.ok) return canonicalImageFromIds(templateId, input.packType, input.setCode);
    const meta = await res.json();
    const raw = extractImageFromMetadata(meta);
    return raw ? normalizeImageUrl(raw) : canonicalImageFromIds(templateId, input.packType, input.setCode);
  } catch {
    return canonicalImageFromIds(templateId, input.packType, input.setCode);
  }
}
