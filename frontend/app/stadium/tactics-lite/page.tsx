import dynamic from "next/dynamic";

const TacticsLiteClient = dynamic(() => import("./TacticsLiteClient"), { ssr: false });
export const revalidate = 0;

export default function Page() {
  return <TacticsLiteClient />;
}
