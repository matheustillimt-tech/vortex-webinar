"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Confere de novo a cada 10 s (sala pode ter vagado): `router.refresh()` reexecuta a página do servidor. */
export default function Tentar() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
