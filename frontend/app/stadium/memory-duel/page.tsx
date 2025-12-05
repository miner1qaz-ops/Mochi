import dynamic from "next/dynamic";

const MemoryDuelClient = dynamic(() => import("./MemoryDuelClient"), { ssr: false });
export const revalidate = 0;

export default function Page() {
  return <MemoryDuelClient />;
}
