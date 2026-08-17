export function RoadmapCard({ title, blurb, items }: { title: string; blurb: string; items: string[] }) {
  return (
    <div className="mx-auto mt-14 max-w-md text-center">
      <span className="mb-4 inline-block rounded-full bg-amber-50 px-3 py-1 text-[10.5px] font-bold text-amber-700">
        Later pass
      </span>
      <h2 className="mb-2 text-[17px] font-bold text-neutral-900">{title}</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-500">{blurb}</p>
      <ul className="inline-block text-left text-[12.5px] leading-loose text-neutral-600">
        {items.map((item) => (
          <li key={item} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
