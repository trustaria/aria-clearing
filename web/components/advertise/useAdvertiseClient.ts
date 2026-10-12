"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMemo, useRef } from "react";
import { createAdvertiseClient, type AdvertiseClient } from "../../lib/advertise-client";

/** One client per mount that signs requests with the current Privy access token. */
export function useAdvertiseClient(): AdvertiseClient {
  const { getAccessToken } = usePrivy();
  const token = useRef(getAccessToken);
  token.current = getAccessToken;
  return useMemo(() => createAdvertiseClient(() => token.current()), []);
}
