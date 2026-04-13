"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

const SIGN_IN_HREF = "/auth/sign-in?redirectTo=%2Fchat";
const SIGN_UP_HREF = "/auth/sign-up?redirectTo=%2Fchat";

/**
 * Client-side auth-aware CTA buttons for the landing page.
 * Keeps the parent page a static Server Component by moving
 * the session check to the client.
 */
export function AuthButtons({ size = "sm" }: { size?: "sm" | "lg" }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    authClient
      .getSession()
      .then((result) => setIsLoggedIn(!!result.data?.user))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // Still loading: render sign-in/sign-up as default (matches SSR output)
  if (isLoggedIn === null) {
    return <AuthFallback size={size} />;
  }

  if (isLoggedIn) {
    return (
      <Button asChild size={size}>
        <Link href="/chat">{size === "lg" ? "Ir para o Chat" : "Abrir App"}</Link>
      </Button>
    );
  }

  return <AuthFallback size={size} />;
}

function AuthFallback({ size }: { size: "sm" | "lg" }) {
  if (size === "lg") {
    return (
      <>
        <Button asChild size="lg">
          <Link href={SIGN_UP_HREF}>Começar agora</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={SIGN_IN_HREF}>Entrar na conta</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href={SIGN_IN_HREF}>Entrar</Link>
      </Button>
      <Button asChild size="sm">
        <Link href={SIGN_UP_HREF}>Criar conta</Link>
      </Button>
    </>
  );
}
