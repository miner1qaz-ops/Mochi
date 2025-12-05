import dynamic from "next/dynamic";

const Connect3Client = dynamic(() => import("./Connect3Client"), { ssr: false });
export const revalidate = 0;

export default function Page() {
  return <Connect3Client />;
}
