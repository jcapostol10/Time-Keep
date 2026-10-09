import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth";

const handler = toNextJsHandler((request) => getAuth().handler(request));

export const { GET, POST } = handler;
