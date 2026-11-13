---
name: dates-and-time-formulas
description: Writes spreadsheet formulas for date differences, deadlines, working days, ages, durations and month ends, and fixes dates that show as numbers or text. Use when the user asks for days between two dates, to add working days, or says dates look like numbers or will not sort.
---

# Dates and time formulas

## Goal

Make date arithmetic correct and readable. A good result keeps real dates in cells (never text), uses the function that matches the rule in words, handles weekends and holidays when they matter, and has been tested on month ends and leap days.

## When to use

- Days, months or years between two dates, or someone's age.
- A due date a number of working days after a start.
- Durations in hours and minutes, or time sheets that cross midnight.
- Date columns that show serial numbers, sort wrongly or refuse to calculate.
- For cleaning text before date parsing, use `use_skill` with `text-cleanup-formulas`.

## Steps

1. Ask what the rule is in words, with an example and the expected answer: "30 calendar days after the invoice date" or "5 working days, not counting weekends and the holidays on the Holidays sheet". Confirm whether the start day counts.
2. Check what the cells really hold. Use `read_file` or `run_command` to print the raw value and type of several cells. A true date is a number with a date format. Text such as `03/04/25` is not, and its meaning depends on the locale (day first or month first). Settle that with the user.
3. Convert text dates with a parse that fits the shape: DATE with LEFT, MID and RIGHT for fixed shapes, or DATEVALUE when the locale agrees. Spot-check ten converted dates against the source.
4. Pick the function for the rule. Days between: subtraction, which returns a number to format as General. Whole months or years: DATEDIF where supported, or YEAR and MONTH arithmetic. Working days: NETWORKDAYS to count, WORKDAY to add. Custom weekends: the INTL versions.
5. Month and year steps: EDATE to add months, EOMONTH for month ends. Adding 1 to the month value of a DATE can overflow correctly, but day 31 into a short month rolls into the next month, so test it.
6. Times: store as fractions of a day. Duration across midnight needs MOD(end-start,1). To show over 24 hours use a custom format with square brackets around the hours. To convert to decimal hours multiply by 24.
7. Keep holidays in a named range on a `Lists` sheet, so rules update in one place. State the year range they cover.
8. Format the output cell to match: a date format for dates, General or number for day counts. A date result showing 1900-something means the format is wrong.
9. Test with `run_command` or a table of cases: a leap day, 31 January plus one month, a start on a Saturday, an end before the start, a blank cell. Report expected against actual.
10. Make the sheet robust to bad input.
   - Wrap the formula so a blank start date returns blank rather than a huge number.
   - Show a clear message when the end date is before the start date, not a negative duration.
   - Add validation to the date columns so text cannot be typed in later.
   - Say which function to change if the weekend or holiday rule changes.

## Gotchas

- Excel and some other apps count dates from different origins (1900 or 1904 systems). Copying dates between workbooks with different settings shifts them by about four years.
- DATEDIF is undocumented in some versions and has known edge-case quirks with month-end dates. Test the cases you need, or use year and month arithmetic.
- Time zones and daylight saving are not part of spreadsheet dates. Store UTC or a single zone and convert outside the formula.
- Floating-point error in times can make a value that should equal exactly 1:00 compare as not equal. Round to seconds before comparing.
- An inclusive count and an exclusive count differ by one day. Write which one you used in the label of the column.
- A "today" function recalculates on every open, so a status computed from it changes by itself. For records, stamp a fixed date.

## Output

- The guards added for blank and reversed dates.
- The formula for the first row with a plain-words explanation, and the cell format to use.
- The assumptions: start day counted or not, weekends, holiday list, date order.
- The test cases with results.
