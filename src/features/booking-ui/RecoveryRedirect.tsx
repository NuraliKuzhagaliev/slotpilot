"use client";

import { useEffect } from "react";

export function RecoveryRedirect() {
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("access_token");
    if (fragment.get("type") === "recovery" && token) {
      const recovery = new URLSearchParams({ type: "recovery", access_token: token });
      window.location.replace("/book#" + recovery);
    }
  }, []);
  return null;
}
