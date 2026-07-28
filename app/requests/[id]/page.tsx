import { RequestDetails } from "./request-details";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetails id={id} />;
}
