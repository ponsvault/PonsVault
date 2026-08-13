/**
 * Largest series the desk will create.
 *
 * Seats are minted as they are bought rather than at creation, so this is a product choice and not a
 * gas ceiling: creating a 4,444-seat series costs a creator the same as a 10-seat one. What does grow
 * with supply is the metadata pack, which is one pinned file per seat.
 */
export const MAX_SEAT_SUPPLY = 4444;
