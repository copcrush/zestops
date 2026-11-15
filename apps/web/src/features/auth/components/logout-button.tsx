"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { sendApiRequest } from "@/lib/browser/api-client";

import { useSession } from "./session-provider";

export function LogoutButton() {
  const { csrfToken } = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await sendApiRequest("/api/auth/logout", { method: "POST", csrfToken });
    // Intentionally a FULL page load (not router.push): it discards the client-side
    // router cache, so pages rendered for the old session cannot reappear via Back.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login?reason=signed-out");
  }

  return (
    <Button variant="secondary" size="sm" onClick={signOut} isLoading={isSigningOut}
            icon={<LogOut aria-hidden className="size-4" />}>
      Sign out
    </Button>
  );
}
