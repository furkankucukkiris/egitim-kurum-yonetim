import { Card } from "@/components/ui/Card";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppearanceSettingsPage() {
  return (
    <Card className="max-w-xl p-6">
      <h2 className="mb-1 text-base font-semibold text-ink">Görünüm</h2>

      <p className="mb-5 text-xs leading-5 text-muted">
        Panelin aydınlık/karanlık temasını seçin. Bu tercih yalnızca bu tarayıcıda
        saklanır.
      </p>

      <ThemeToggle />
    </Card>
  );
}
