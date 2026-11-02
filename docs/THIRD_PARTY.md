# Third-party data

## Public holidays: date-holidays

The holiday import (`packages/core/src/holiday-import.ts`, the Time off page's
"Import public holidays") reads the dataset bundled with
[date-holidays](https://github.com/commenthol/date-holidays) 3.38.0.

- Code: ISC licence.
- Data: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
  (CC BY 3.0), © the date-holidays contributors. Source:
  <https://github.com/commenthol/date-holidays/tree/master/data>.
- Attribution, shown in the import dialog: "Holiday data: date-holidays (CC BY 3.0)".

TimeKeep copies the chosen rows into the workspace's own `holiday` table after an
admin reviews them; admins can rename or delete any imported day. Islamic-calendar
dates are computed and marked "Estimated: confirm the proclaimed date".
