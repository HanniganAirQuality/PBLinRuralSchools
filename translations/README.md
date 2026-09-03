# Translation workbook scripts

Install the one required package:

```powershell
python -m pip install -r translations/requirements.txt
```

Create `translations/translations.xlsx` from the locale JSON files:

```powershell
python translations/json_to_excel.py
```

Each English JSON catalog gets a sheet. The columns are `Key`, followed by the
locale folder names (`en`, `pt-BR`, and so on). Blank translation cells are left
out of that locale's JSON file when the workbook is imported.

Convert the edited workbook back to JSON:

```powershell
python translations/excel_to_json.py
```

By default this updates files under `translations/locales`. To check the result
without touching those files, choose another output directory:

```powershell
python translations/excel_to_json.py --output-dir translations/roundtrip-test
```

Run either script with `--help` to override the locale directory, English folder
name, workbook path, or JSON output directory.
