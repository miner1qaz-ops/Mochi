import dynamic from "next/dynamic";

const RpsPlusClient = dynamic(() => import("./RpsPlusClient"), { ssr: false });
export const revalidate = 0;

export default function Page() {
  return <RpsPlusClient />;
}
