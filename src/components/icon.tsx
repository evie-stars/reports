import Image, { type StaticImageData } from "next/image";
import contacts from "../../public/icons/contacts.svg";
import edit from "../../public/icons/edit.svg";
import graph from "../../public/icons/graph.svg";
import home from "../../public/icons/home.svg";
import location from "../../public/icons/location.svg";
import search from "../../public/icons/search.svg";
import settings from "../../public/icons/settings.svg";
import tags from "../../public/icons/tags.svg";

export type IconName = "contacts" | "edit" | "graph" | "home" | "location" | "search" | "settings" | "tags";

const icons: Record<IconName, StaticImageData> = {
  contacts,
  edit,
  graph,
  home,
  location,
  search,
  settings,
  tags
};

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <Image
      alt={label ?? ""}
      className="icon"
      height={18}
      src={icons[name]}
      width={18}
    />
  );
}
