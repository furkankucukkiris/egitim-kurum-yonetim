import { Card } from "../ui/Card";

interface SummaryItem {
  label: string;
  value: string;
}

interface DashboardSummaryProps {
  items: SummaryItem[];
}

// Kullanım:
// <DashboardSummary items={[
//   { label: "Bugünkü oturum", value: "12" },
//   { label: "Bu ay tahsilat", value: "48.200 ₺" },
// ]} />
export function DashboardSummary({ items }: DashboardSummaryProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {items.map((item) => (
        <Card key={item.label} className="p-3.5">
          <p className="text-xs text-gray-500 mb-1">{item.label}</p>
          <p className="text-xl font-medium text-brand-900">{item.value}</p>
        </Card>
      ))}
    </div>
  );
}
