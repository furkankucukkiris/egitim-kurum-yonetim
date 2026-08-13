import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}
