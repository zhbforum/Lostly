import { listings } from '@/db/schema';

export const publicListingSelection = {
  id: listings.id,
  kind: listings.kind,
  status: listings.status,
  title: listings.title,
  description: listings.description,
  location: listings.location,
  occurredOn: listings.occurredOn,
  createdAt: listings.createdAt,
  updatedAt: listings.updatedAt,
};
