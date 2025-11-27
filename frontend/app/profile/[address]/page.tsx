'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../lib/api';

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;
  const [assets, setAssets] = useState<any[]>([]);

  useEffect(() => {
    if (!address) return;
    api
      .get(`/profile/${address}`)
      .then((res) => setAssets(res.data.assets || []))
      .catch(console.error);
  }, [address]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Profile</h1>
        <p className="text-white/60">{address}</p>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {assets.map((asset) => {
          const name = asset.content?.metadata?.name || 'Core asset';
          const image = asset.content?.links?.image || asset.content?.metadata?.image || '';
          return (
            <div key={asset.id} className="card-blur rounded-2xl p-3 border border-white/5 space-y-3">
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-white/10 bg-black/20">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt={name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-xs text-white/50">
                    No image
                  </div>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{name}</p>
                <p className="text-xs text-white/60 break-all">{asset.id}</p>
              </div>
            </div>
          );
        })}
        {!assets.length && <p className="text-white/60">No assets found.</p>}
      </div>
    </div>
  );
}
