import { Shell } from "@/components/bx/Shell";
import { VaultGate } from "@/components/VaultGate";
import { Toaster } from "@/components/ui";
import { UpdateBanner } from "@/components/UpdateBanner";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Shell>
      <VaultGate>{children}</VaultGate>
      <Toaster />
      <UpdateBanner />
    </Shell>
  );
}
