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
      <div className="grid md:grid-cols-3 gap-4">
        {assets.map((asset) => (
          <div key={asset.id} className="card-blur rounded-2xl p-4 border border-white/5">
            <p className="font-semibold">{asset.content?.metadata?.name || 'Core asset'}</p>
            <p className="text-xs text-white/60 break-all">{asset.id}</p>
          </div>
        ))}
        {!assets.length && <p className="text-white/60">No assets found.</p>}
      </div>
    </div>
  );
}
