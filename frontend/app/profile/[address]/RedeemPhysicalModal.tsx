'use client';

import { useEffect, useMemo, useState } from 'react';

export type RedemptionAsset = {
  id: string;
  name: string;
  rarity?: string;
  image?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  assets: RedemptionAsset[];
  walletAddress?: string;
};

type FormState = {
  selectedAssets: string[];
  fullName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  email: string;
  phoneCode: string;
  phoneNumber: string;
  contactMethod: 'telegram' | 'discord' | 'whatsapp';
  contactHandle: string;
  acknowledged: boolean;
  confirmationPhrase: string;
};

const initialForm: FormState = {
  selectedAssets: [],
  fullName: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  postal: '',
  country: '',
  email: '',
  phoneCode: '+1',
  phoneNumber: '',
  contactMethod: 'discord',
  contactHandle: '',
  acknowledged: false,
  confirmationPhrase: '',
};

const phoneCodes = ['+1', '+44', '+61', '+65', '+81', '+49', '+33'];
const contactOptions = [
  { value: 'telegram', label: 'Telegram Handle' },
  { value: 'discord', label: 'Discord Username' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const mockAssets: RedemptionAsset[] = [
  { id: 'demo-1', name: 'Mock Dragonite EX #021', rarity: 'Ultra Rare', image: '/card_back.png' },
  { id: 'demo-2', name: 'Mock Sylveon V #045', rarity: 'Illustration Rare', image: '/card_back.png' },
  { id: 'demo-3', name: 'Mock Charizard GX #150', rarity: 'Special Illustration', image: '/card_back.png' },
];

export default function RedeemPhysicalModal({ open, onClose, assets, walletAddress }: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(initialForm);
      setErrors({});
      setSubmitting(false);
      setTicketId(null);
      setSubmitError(null);
    }
  }, [open]);

  const displayAssets = useMemo<RedemptionAsset[]>(() => {
    if (assets?.length) return assets;
    return mockAssets;
  }, [assets]);

  const contactLabel = useMemo(
    () => contactOptions.find((o) => o.value === form.contactMethod)?.label || 'contact method',
    [form.contactMethod]
  );

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as string]) {
      setErrors((prev) => {
        const clone = { ...prev };
        delete clone[key as string];
        return clone;
      });
    }
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.selectedAssets.length) nextErrors.selectedAssets = 'Select at least one NFT to redeem.';
    if (!form.fullName.trim()) nextErrors.fullName = 'Full name is required.';
    if (!form.address1.trim()) nextErrors.address1 = 'Address line 1 is required.';
    if (!form.address2.trim()) nextErrors.address2 = 'Address line 2 is required.';
    if (!form.city.trim()) nextErrors.city = 'City is required.';
    if (!form.state.trim()) nextErrors.state = 'State/Province is required.';
    if (!form.postal.trim()) nextErrors.postal = 'Zip/Postal code is required.';
    if (!form.country.trim()) nextErrors.country = 'Country is required.';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) nextErrors.email = 'Enter a valid email.';
    if (!form.phoneNumber.trim()) nextErrors.phoneNumber = 'Phone number is required.';
    if (!form.contactHandle.trim()) nextErrors.contactHandle = 'Provide your handle so we can verify.';
    if (!form.acknowledged) nextErrors.acknowledged = 'You must accept the burn and invoice terms.';
    if (form.confirmationPhrase.trim().toUpperCase() !== 'BURN') {
      nextErrors.confirmationPhrase = "Type 'BURN' to confirm this destroys the NFT.";
    }
    return nextErrors;
  };

  const inputClass = (key: keyof FormState) =>
    `w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 ${
      errors[key] ? 'border border-red-400/70 focus:ring-red-300/60' : 'border border-white/15 focus:ring-aurora/40'
    }`;

  const handleSubmit = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    setSubmitError(null);
    const selectedAssets = displayAssets.filter((asset) => form.selectedAssets.includes(asset.id));
    const payload = {
      walletAddress,
      assets: selectedAssets,
      shipping: {
        fullName: form.fullName,
        address1: form.address1,
        address2: form.address2,
        city: form.city,
        state: form.state,
        postal: form.postal,
        country: form.country,
        email: form.email,
        phoneCode: form.phoneCode,
        phoneNumber: form.phoneNumber,
      },
      contact: {
        method: form.contactMethod,
        handle: form.contactHandle,
      },
      acknowledged: form.acknowledged,
    };

    fetch('/api/redemption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const message = data?.error || 'Redemption request failed.';
          throw new Error(message);
        }
        const data = await res.json();
        const ticket = data.ticketId || data.id;
        if (!ticket) throw new Error('Ticket ID missing in response.');
        setTicketId(ticket);
      })
      .catch((err: Error) => {
        setSubmitError(err.message || 'Unable to submit redemption request.');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-b from-[#0b0f1a] to-[#090d17] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/70 hover:text-white"
        >
          Close
        </button>

        {ticketId ? (
          <div className="space-y-4 text-center py-6">
            <div className="text-sm uppercase tracking-[0.25em] text-white/50">Request received</div>
            <h2 className="text-3xl font-semibold text-white">Ticket #{ticketId}</h2>
            <p className="text-white/70">
              Request Received. Ticket #{ticketId} created. Our team will reach out to you via {contactLabel} within 48 hours to
              verify identity and finalize payment and shipping. No payment was taken in this step.
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setForm(initialForm);
                  setTicketId(null);
                  onClose();
                }}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:border-aurora/50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(initialForm);
                  setTicketId(null);
                  setErrors({});
                }}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:text-white"
              >
                New request
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Redeem Physical Asset</p>
              <h2 className="text-2xl font-semibold text-white">Request Physical Redemption</h2>
              <p className="text-sm text-white/70">
                This creates a manual ticket. NFTs redeemed physically are burned and removed from gameplay/marketplace. We&apos;ll
                verify ownership and send a shipping invoice separately.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
              <div className="text-sm font-semibold text-amber-100">Warning</div>
              <p className="text-sm text-amber-50">
                Proceeding will burn your NFT. This card will no longer be usable in Mochi games or the marketplace. Consider
                listing or trading if you still want digital utility.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Step 1 · Asset selection</h3>
                <span className="text-xs text-white/60">Pick the card(s) to withdraw</span>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {displayAssets.map((asset) => {
                  const selected = form.selectedAssets.includes(asset.id);
                  return (
                    <label
                      key={asset.id}
                      className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2 transition ${
                        selected ? 'border-aurora/60 bg-aurora/10' : 'border-white/10 bg-white/5 hover:border-white/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={selected}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((prev) => ({
                            ...prev,
                            selectedAssets: checked
                              ? [...prev.selectedAssets, asset.id]
                              : prev.selectedAssets.filter((id) => id !== asset.id),
                          }));
                        }}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.image || '/card_back.png'}
                        alt={asset.name}
                        className="h-14 w-10 rounded-lg border border-white/10 bg-black/30 object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{asset.name}</div>
                        <div className="text-xs text-white/60 truncate">{asset.rarity || 'Card'}</div>
                        <div className="text-[11px] text-white/50 truncate">{asset.id}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {errors.selectedAssets && <p className="text-xs text-red-300">{errors.selectedAssets}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Step 2 · Shipping details</h3>
                <span className="text-xs text-white/60">Required for invoicing and delivery</span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="text-sm text-white/70">Full Name</label>
                  <input
                    className={inputClass('fullName')}
                    value={form.fullName}
                    onChange={(e) => updateField('fullName', e.target.value)}
                    placeholder="Name on the package"
                  />
                  {errors.fullName && <p className="text-xs text-red-300">{errors.fullName}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">Address Line 1</label>
                  <input
                    className={inputClass('address1')}
                    value={form.address1}
                    onChange={(e) => updateField('address1', e.target.value)}
                    placeholder="Street address"
                  />
                  {errors.address1 && <p className="text-xs text-red-300">{errors.address1}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">Address Line 2</label>
                  <input
                    className={inputClass('address2')}
                    value={form.address2}
                    onChange={(e) => updateField('address2', e.target.value)}
                    placeholder="Unit, suite, etc."
                  />
                  {errors.address2 && <p className="text-xs text-red-300">{errors.address2}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">City</label>
                  <input
                    className={inputClass('city')}
                    value={form.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    placeholder="City"
                  />
                  {errors.city && <p className="text-xs text-red-300">{errors.city}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">State / Province</label>
                  <input
                    className={inputClass('state')}
                    value={form.state}
                    onChange={(e) => updateField('state', e.target.value)}
                    placeholder="State or province"
                  />
                  {errors.state && <p className="text-xs text-red-300">{errors.state}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">Zip / Postal Code</label>
                  <input
                    className={inputClass('postal')}
                    value={form.postal}
                    onChange={(e) => updateField('postal', e.target.value)}
                    placeholder="Postal code"
                  />
                  {errors.postal && <p className="text-xs text-red-300">{errors.postal}</p>}
                </div>
                <div>
                  <label className="text-sm text-white/70">Country</label>
                  <input
                    className={inputClass('country')}
                    value={form.country}
                    onChange={(e) => updateField('country', e.target.value)}
                    placeholder="Country"
                  />
                  {errors.country && <p className="text-xs text-red-300">{errors.country}</p>}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-white/70">Email Address</label>
                <input
                  className={inputClass('email')}
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="you@email.com"
                />
                {errors.email && <p className="text-xs text-red-300">{errors.email}</p>}
              </div>
              <div>
                <label className="text-sm text-white/70">Phone Number</label>
                <div className="flex gap-2">
                  <select
                    className={`w-24 rounded-lg bg-white/5 px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 ${
                      errors.phoneNumber ? 'border border-red-400/70 focus:ring-red-300/60' : 'border border-white/15 focus:ring-aurora/40'
                    }`}
                    value={form.phoneCode}
                    onChange={(e) => updateField('phoneCode', e.target.value)}
                  >
                    {phoneCodes.map((code) => (
                      <option key={code} value={code} className="bg-[#0b0f1a]">
                        {code}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass('phoneNumber')}
                    value={form.phoneNumber}
                    onChange={(e) => updateField('phoneNumber', e.target.value)}
                    placeholder="Mobile number"
                  />
                </div>
                {errors.phoneNumber && <p className="text-xs text-red-300">{errors.phoneNumber}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Step 3 · Verification contact</h3>
                <span className="text-xs text-white/60">We&apos;ll ping you here to verify and invoice</span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-white/70">Preferred Contact</label>
                  <select
                    className={`w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 ${
                      errors.contactHandle ? 'border border-red-400/70 focus:ring-red-300/60' : 'border border-white/15 focus:ring-aurora/40'
                    }`}
                    value={form.contactMethod}
                    onChange={(e) => updateField('contactMethod', e.target.value as FormState['contactMethod'])}
                  >
                    {contactOptions.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#0b0f1a]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-white/70">Handle / Username</label>
                  <input
                    className={inputClass('contactHandle')}
                    value={form.contactHandle}
                    onChange={(e) => updateField('contactHandle', e.target.value)}
                    placeholder="e.g. @trainer#0001"
                  />
                  {errors.contactHandle && <p className="text-xs text-red-300">{errors.contactHandle}</p>}
                </div>
              </div>
              <p className="text-xs text-white/60">
                Mochi support will contact you via the selected channel to verify identity and provide the final shipping invoice.
              </p>
            </div>

            <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 items-start">
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-lg font-semibold">Step 4 · Fee acknowledgement</h3>
                <p className="text-sm text-white/70">
                  Shipping, insurance, and vault handling run about $20–$30 USD. Final costs depend on destination and will be
                  invoiced after verification; no payment is taken here.
                </p>
                <label className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${errors.acknowledged ? 'border-red-400/70' : 'border-white/10 bg-black/20'}`}>
                  <input
                    type="checkbox"
                    checked={form.acknowledged}
                    onChange={(e) => updateField('acknowledged', e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/30 bg-black/50"
                  />
                  <span className="text-sm text-white/80">
                    I understand that I will be invoiced separately for shipping fees and that my NFT will be burned upon shipment.
                  </span>
                </label>
                {errors.acknowledged && <p className="text-xs text-red-300">{errors.acknowledged}</p>}
                <div>
                  <label className="text-sm text-white/70">Final confirmation</label>
                  <input
                    className={inputClass('confirmationPhrase')}
                    value={form.confirmationPhrase}
                    onChange={(e) => updateField('confirmationPhrase', e.target.value)}
                    placeholder="Type BURN to arm submission"
                  />
                  {errors.confirmationPhrase && <p className="text-xs text-red-300">{errors.confirmationPhrase}</p>}
                  <p className="text-xs text-white/50 mt-1">
                    Double-check your choices—redeeming destroys the NFT. This extra step keeps marketplace supply accurate.
                  </p>
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-4">
                <div className="text-sm font-semibold text-white">Estimated costs</div>
                <p className="text-2xl font-semibold text-aurora">$20.00 – $30.00 USD</p>
                <p className="text-sm text-white/70">Shipping, Insurance & Vault Handling</p>
                <div className="rounded-xl bg-black/30 border border-white/10 p-3 text-sm text-white/70">
                  <ul className="space-y-1 list-disc list-inside">
                    <li>No payment collected in this form.</li>
                    <li>Invoice sent after identity check and address confirmation.</li>
                    <li>Vault team packages cards with tamper-evident seals.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-white/60">
                Submission is deliberately low-friction visually. Take a breath and be sure you want to burn the digital card.
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  submitting
                    ? 'border-white/20 bg-white/10 text-white/50'
                    : 'border-white/20 bg-white/10 text-white/80 hover:border-aurora/50 hover:text-white'
                }`}
              >
                {submitting ? 'Submitting…' : 'Confirm burn & send request'}
              </button>
            </div>
            {submitError && <p className="text-xs text-red-300">{submitError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
