import { Shell } from "@/components/bx/Shell";
import { VaultGate } from "@/components/VaultGate";
import { Toaster } from "@/components/ui";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Shell>
      <VaultGate>{children}</VaultGate>
      <Toaster />
    </Shell>
  );
}
