import apiApp from "@/server/app";

export async function handleAppRoute(request: Request): Promise<Response> {
  return apiApp.fetch(request);
}
