"use client";

import { useEffect } from "react";

import { consumeLandingHashOnLoad } from "@/components/landing/scroll-to-section";

/** Au mount : /#faq (anciens liens) → scroll + replaceState sans hash. */
export function LandingHashCleanup() {
  useEffect(() => {
    consumeLandingHashOnLoad();
  }, []);

  return null;
}
