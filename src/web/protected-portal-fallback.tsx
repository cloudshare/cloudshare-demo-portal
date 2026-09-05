"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pageShellStyle } from "./page-shell";
import { startPortalSessionWatchdog } from "./session-expiry";

interface ProtectedPortalFallbackProps {
  readonly title: string;
  readonly message: string;
}

export function ProtectedPortalFallback({
  title,
  message,
}: ProtectedPortalFallbackProps) {
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);
  const expireSession = useCallback(() => {
    setSessionExpired(true);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const watchdog = startPortalSessionWatchdog({ fetchImpl: fetch, onExpired: expireSession });
    void watchdog.checkNow();
    return watchdog.stop;
  }, [expireSession]);

  if (sessionExpired) return <main style={pageShellStyle}>Continuing to sign in…</main>;

  return (
    <main style={pageShellStyle}>
      <h1>{title}</h1>
      <p>{message}</p>
    </main>
  );
}
