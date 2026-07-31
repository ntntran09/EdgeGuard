export function formatTelegramAlertTime(value, timeZone = 'Asia/Ho_Chi_Minh') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.hour}:${parts.minute}:${parts.second} ${Number(parts.day)}/${Number(parts.month)}/${parts.year}`;
}
