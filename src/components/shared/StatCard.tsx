import { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon?: ReactNode;
  changeColor?: "success" | "warning" | "destructive" | "muted";
}

export function StatCard({ title, value, change, icon, changeColor = "success" }: StatCardProps) {
  const colorMap = {
    success: "text-green-600",
    warning: "text-amber-600",
    destructive: "text-red-600 font-bold",
    muted: "text-slate-400",
  };

  return (
    <div className="bg-white rounded-[20px] border border-slate-100 p-5 lg:p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] lg:text-[11px] text-slate-400 font-black uppercase tracking-widest">{title}</span>
        {icon && <div className="p-2 bg-slate-50 rounded-lg text-slate-400">{icon}</div>}
      </div>
      <div className="text-2xl lg:text-3xl font-black text-[#1e3a8a]">{value}</div>
      {change && (
        <p className={`text-[10px] lg:text-xs mt-2 font-bold uppercase tracking-wider ${colorMap[changeColor]}`}>
          <span className="mr-1">↑</span>{change}
        </p>
      )}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="mb-5 lg:mb-7">
      <h1 className="text-2xl lg:text-3xl font-black text-[#1e293b] tracking-tight">{title}</h1>
      <p className="text-slate-400 font-medium text-xs lg:text-sm mt-1">{subtitle}</p>
    </div>
  );
}

