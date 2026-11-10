/**
 * Native React DOM permits explicit undefined on optional props; React Aria uses
 * exact optional properties. Remove undefined values at the adapter boundary,
 * keeping handlers, refs, false, zero and empty strings unchanged.
 */
export function definedProps<T extends object>(props: T): { [K in keyof T]: Exclude<T[K], undefined> } {
    return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as {
        [K in keyof T]: Exclude<T[K], undefined>;
    };
}
