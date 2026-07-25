export const dashboardStats = [
  { label: "Aktif Öğrenci", value: "104", change: "+6 bu ay", tone: "positive" },
  { label: "Aylık Tahakkuk", value: "₺318.400", change: "%82 tahsil edildi", tone: "neutral" },
  { label: "Bekleyen Ödeme", value: "₺57.250", change: "14 öğrenci", tone: "warning" },
  { label: "Kasadaki Nakit", value: "₺12.600", change: "ATM yatırımı bekliyor", tone: "warning" },
] as const;

export const recentPayments = [
  { student: "Defne Yılmaz", course: "Piyano", amount: 4400, method: "Havale", status: "Ödendi" },
  { student: "Çınar Demir", course: "Resim", amount: 3960, method: "Nakit", status: "Ödendi" },
  { student: "Eylül Kaya", course: "Drama", amount: 2000, method: "Kart", status: "Kısmi" },
  { student: "Işıl Akın", course: "Gitar", amount: 4400, method: "Havale", status: "Ödendi" },
];

export const courses = [
  { name: "Piyano", students: 35, revenue: 145000, growth: 4 },
  { name: "Resim", students: 28, revenue: 104000, growth: 2 },
  { name: "Yaratıcı Drama", students: 18, revenue: 65000, growth: 1 },
  { name: "Gitar", students: 12, revenue: 42000, growth: -1 },
  { name: "İngilizce", students: 11, revenue: 36000, growth: 0 },
];

export const students = [
  { name: "Defne Yılmaz", guardian: "Merve Yılmaz", course: "Piyano", phone: "05•• ••• •• 12", balance: 0, status: "Aktif" },
  { name: "Çınar Demir", guardian: "Aslı Demir", course: "Resim", phone: "05•• ••• •• 27", balance: 3960, status: "Aktif" },
  { name: "Eylül Kaya", guardian: "Zeynep Kaya", course: "Drama", phone: "05•• ••• •• 48", balance: 1960, status: "Aktif" },
  { name: "Işıl Akın", guardian: "Selin Akın", course: "Gitar", phone: "05•• ••• •• 65", balance: 0, status: "Aktif" },
  { name: "Aras Çelik", guardian: "Derya Çelik", course: "İngilizce", phone: "05•• ••• •• 82", balance: 4400, status: "Donduruldu" },
];

export const teachers = [
  { name: "Latife Eda Uncuuoğlu", branch: "Piyano", students: 35, planned: 40, completed: 37, payment: 52000 },
  { name: "Seda Nur", branch: "Yaratıcı Drama", students: 18, planned: 16, completed: 15, payment: 18000 },
  { name: "Nisa", branch: "Resim", students: 28, planned: 24, completed: 23, payment: 10000 },
];
