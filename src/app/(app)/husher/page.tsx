"use client";
import { useState } from "react";
import { HusherMixer } from "@/components/portfolio/HusherMixer";
import { useWallets } from "@/lib/store";
import { BxButton } from "@/components/bx/ui";
export default function HusherPage() {
  const wallets = useWallets();
  const [open, setOpen] = useState(false);
  return <div className="mx-auto w-full max-w-3xl p-6"><h1 className="text-xl font-semibold text-text-100">Husher Exchange</h1><p className="my-4 text-sm text-text-300">Quote a SOL → SOL exchange, distribute it across your wallets, create deposit instructions and track the order in DONCHAIN.</p><BxButton variant="primary" onClick={() => setOpen(true)} disabled={!wallets.data}>Open Mixer</BxButton>{open ? <HusherMixer wallets={wallets.data?.wallets ?? []} onClose={() => setOpen(false)} /> : null}</div>;
}
