import { Navbar } from "@/components/Navbar";
import { VaultGate } from "@/components/VaultGate";
import { Toaster } from "@/components/ui";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Navbar />
      <VaultGate>
        <main className="flex-1 flex flex-col min-h-0">{children}</main>
      </VaultGate>
      <Toaster />
    </>
  );
}
