import dynamic from "next/dynamic";

const SpeedMatchClient = dynamic(() => import("./SpeedMatchClient"), { ssr: false });
export const revalidate = 0;

export default function Page() {
  return <SpeedMatchClient />;
}
