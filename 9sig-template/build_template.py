#!/usr/bin/env python3
"""Build the independent 9Sig teaching spreadsheet and self-contained guide."""
from __future__ import annotations

import base64
import csv
import io
import json
from decimal import Decimal, ROUND_DOWN
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import markdown
import xlsxwriter

ROOT = Path(__file__).resolve().parent
NAME = "9Sig_Google_Sheets_Template"
GUIDE = "9Sig_Google_Sheets_Guide.md"
HEADERS = [
    "Quarter", "Date", "TQQQ Price", "Reserve Unit Price",
    "TQQQ Shares Before", "Reserve Units Before", "TQQQ Value Before",
    "Reserve Value Before", "Portfolio Before", "Signal Target",
    "Raw Signal Amount", "Buy Cap Amount", "Requested Trade Amount",
    "Allowed Trade Amount", "Trade Shares", "Executed Trade Amount",
    "TQQQ Shares After", "Reserve Units After", "TQQQ Value After",
    "Reserve Value After", "Portfolio After", "Next Signal Base",
    "Ignore Sell (0 or 1)", "Reset Stock Weight (optional)",
    "Next Base Override (optional)", "Quarterly Target Rate",
    "Max Reserve Use", "Share Decimals", "Action", "Check", "Notes",
]


def input_check(r: int) -> str:
    parts = [
        f"COUNT(C{r}:F{r})=4", f"C{r}>0", f"D{r}>0", f"E{r}>=0", f"F{r}>=0",
        f"ISNUMBER(J{r})", f"J{r}>=0",
        f"ISNUMBER(Z{r})", f"Z{r}>=0",
        f"ISNUMBER(AA{r})", f"AA{r}>=0", f"AA{r}<=1",
        f"ISNUMBER(AB{r})", f"AB{r}>=0", f"AB{r}<=6", f"AB{r}=INT(AB{r})",
        f"ISNUMBER(W{r})", f"OR(W{r}=0,W{r}=1)",
        f'OR(X{r}="",AND(ISNUMBER(X{r}),X{r}>=0,X{r}<=1))',
        f'OR(Y{r}="",AND(ISNUMBER(Y{r}),Y{r}>=0))',
    ]
    if r == 2:
        parts += [f"W{r}=0", f'X{r}=""', f'Y{r}=""']
    else:
        parts += [f'AD{r-1}="OK"']
    return "AND(" + ",".join(parts) + ")"


def formula_row(r: int, quarter: str, date: str, price: float) -> list:
    first = r == 2
    valid = input_check(r)
    allowed = (
        "=0" if first else
        f'=IFERROR(IF({valid},IF(AND(W{r}=1,M{r}<0),0,'
        f'IF(M{r}>0,MIN(M{r},L{r}),MAX(M{r},-G{r}))),0),0)'
    )
    check = (
        f'=IFERROR(IF(NOT({valid}),"INVALID INPUT",'
        f'IF(AND(Q{r}>=-0.000001,R{r}>=-0.000001,'
        f'ABS(U{r}-I{r})<0.000001,P{r}<=L{r}+0.000001),'
        '"OK","CHECK BALANCES")),"INVALID INPUT")'
    )
    return [
        quarter, date, price, 1,
        1000 if first else f"=Q{r-1}",
        60000 if first else f"=R{r-1}",
        f"=E{r}*C{r}", f"=F{r}*D{r}", f"=G{r}+H{r}",
        f"=G{r}" if first else f"=V{r-1}*(1+Z{r})",
        "=0" if first else f"=J{r}-G{r}",
        f"=MAX(0,H{r})*AA{r}",
        "=0" if first else f'=IF(X{r}="",K{r},I{r}*X{r}-G{r})',
        allowed, f"=IFERROR(TRUNC(N{r}/C{r},AB{r}),0)", f"=O{r}*C{r}",
        f"=E{r}+O{r}", f"=F{r}-P{r}/D{r}", f"=Q{r}*C{r}",
        f"=R{r}*D{r}", f"=S{r}+T{r}", f'=IF(Y{r}="",S{r},Y{r})',
        0, "", "", 0.09 if first else "=$Z$2",
        0.9 if first else "=$AA$2", 0 if first else "=$AB$2",
        f'=IF(AD{r}<>"OK","BLOCKED","INIT")' if first else
        f'=IF(AD{r}<>"OK","BLOCKED",IF(O{r}>0,"BUY",IF(O{r}<0,"SELL","HOLD")))',
        check,
        "自定义40/60起点；演示价格；现金储备；非完整官方规则" if first else
        "演示价格；W/X/Y为手动控制；新增季度须清除临时设置",
    ]


def example_results() -> list[list]:
    """Independent Decimal calculations, also used as workbook preview caches."""
    shares, reserve, base = Decimal(1000), Decimal(60000), Decimal(40000)
    rows = []
    for i, (quarter, date, price) in enumerate(SAMPLES):
        p = Decimal(str(price))
        stock, cash = shares * p, reserve
        target = stock if i == 0 else base * Decimal("1.09")
        raw = Decimal(0) if i == 0 else target - stock
        cap = cash * Decimal("0.9")
        allowed = min(raw, cap) if raw > 0 else max(raw, -stock)
        trade = (allowed / p).quantize(Decimal(1), rounding=ROUND_DOWN)
        amount = trade * p
        new_shares, new_cash = shares + trade, cash - amount
        new_stock = new_shares * p
        action = "INIT" if i == 0 else ("BUY" if trade > 0 else "SELL" if trade < 0 else "HOLD")
        rows.append([
            quarter, date, p, 1, shares, reserve, stock, cash, stock + cash,
            target, raw, cap, raw, allowed, trade, amount, new_shares,
            new_cash, new_stock, new_cash, new_stock + new_cash, new_stock,
            0, "", "", Decimal("0.09"), Decimal("0.9"), 0,
            action, "OK", formula_row(i + 2, quarter, date, price)[-1],
        ])
        shares, reserve, base = new_shares, new_cash, new_stock
    return rows


SAMPLES = [
    ("Q0 (Init)", "2024-01-02", 40),
    ("Q1", "2024-03-28", 50),
    ("Q2", "2024-06-28", 35),
    ("Q3", "2024-09-30", 42),
]


def write_csv(path: Path, rows: list[list]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerows([HEADERS, *rows])
    content = "\ufeff" + stream.getvalue()
    path.write_text(content, encoding="utf-8", newline="")
    return content


def build_workbook(rows: list[list], expected: list[list], guide: str) -> None:
    workbook = xlsxwriter.Workbook(ROOT / f"{NAME}.xlsx")
    workbook.set_properties({
        "title": "Jason Kelly 9Sig 自定义教学模板",
        "comments": "40/60 cash example; independent template, not the official 9Sig manual.",
    })
    sheet = workbook.add_worksheet("9Sig Template")
    header = workbook.add_format({"bold": True, "font_color": "white", "bg_color": "#173D39", "text_wrap": True, "valign": "vcenter"})
    numeric = {"num_format": '#,##0.00####;[Red]-#,##0.00####;0', "valign": "vcenter"}
    input_format = workbook.add_format({**numeric, "bg_color": "#E9F3FC", "font_color": "#154D82"})
    formula_format = workbook.add_format({**numeric, "bg_color": "#F3F5F4"})
    percent_input = workbook.add_format({"num_format": "0.00%", "bg_color": "#E9F3FC", "font_color": "#154D82"})
    percent_formula = workbook.add_format({"num_format": "0.00%", "bg_color": "#F3F5F4"})
    integer_input = workbook.add_format({"num_format": "0", "bg_color": "#E9F3FC", "font_color": "#154D82"})
    integer_formula = workbook.add_format({"num_format": "0", "bg_color": "#F3F5F4"})
    note_format = workbook.add_format({"text_wrap": True, "font_color": "#52615C"})
    sheet.write_row(0, 0, HEADERS, header)
    sheet.set_row(0, 54)
    sheet.set_column("A:B", 15)
    sheet.set_column("C:AB", 20)
    sheet.set_column("AC:AD", 18)
    sheet.set_column("AE:AE", 52, note_format)
    sheet.freeze_panes(1, 2)
    sheet.autofilter(0, 0, len(rows), len(HEADERS) - 1)
    for i, row in enumerate(rows, 1):
        sheet.set_row(i, 48)
        for col, value in enumerate(row):
            is_formula = isinstance(value, str) and value.startswith("=")
            fmt = formula_format if is_formula else input_format
            if col in (23, 25, 26):
                fmt = percent_formula if is_formula else percent_input
            elif col in (22, 27):
                fmt = integer_formula if is_formula else integer_input
            elif col == 30:
                fmt = note_format
            if is_formula:
                cache = expected[i - 1][col]
                if isinstance(cache, Decimal):
                    cache = float(cache)
                sheet.write_formula(i, col, value, fmt, cache)
            else:
                sheet.write(i, col, value, fmt)
    sheet.data_validation("C2:D1000", {"validate": "decimal", "criteria": ">", "value": 0, "error_type": "stop", "error_message": "价格必须大于0。"})
    sheet.data_validation("W2:W1000", {"validate": "list", "source": ["0", "1"]})
    sheet.data_validation("X2:X1000", {"validate": "decimal", "criteria": "between", "minimum": 0, "maximum": 1, "ignore_blank": True})
    sheet.data_validation("Y2:Y1000", {"validate": "decimal", "criteria": ">=", "value": 0, "ignore_blank": True})
    sheet.data_validation("Z2:Z1000", {"validate": "decimal", "criteria": ">=", "value": 0})
    sheet.data_validation("AA2:AA1000", {"validate": "decimal", "criteria": "between", "minimum": 0, "maximum": 1})
    sheet.data_validation("AB2:AB1000", {"validate": "integer", "criteria": "between", "minimum": 0, "maximum": 6})
    sheet.write_comment("J1", "本模板使用上一季实际调仓后股票市值乘(1+季度目标率)。不是保证收益。")
    sheet.write_comment("W1", "每季手动设置。1=暂停所有卖出，包括X列请求的重置卖出；买入仍按上限执行。")
    sheet.write_comment("X1", "留空=不重置；0.4=请求股票占比40%；0=请求卖光。仍受W和AA限制。")
    sheet.write_comment("Y1", "可选下一季度基数覆盖；会改变未来信号。初始行必须留空。")
    sheet.write_comment("AB1", "向零截断交易股数。0=整股，最多6位；券商需支持所选精度。")
    sheet.write_comment("AD1", "OK表示本模板的输入及资金守恒检查通过，不表示已验证完整官方策略或真实券商成交。")
    red = workbook.add_format({"bg_color": "#FDE9E7", "font_color": "#9B2424"})
    sheet.conditional_format("AD2:AD1000", {"type": "formula", "criteria": '=AND(AD2<>"",AD2<>"OK")', "format": red})
    notes = workbook.add_worksheet("中文指南")
    notes.set_column("A:A", 115)
    wrap = workbook.add_format({"text_wrap": True, "valign": "top", "font_size": 11})
    for i, line in enumerate(guide.splitlines()):
        notes.write_string(i, 0, line, wrap)
        notes.set_row(i, max(20, ((len(line) // 62) + 1) * 18))
    notes.freeze_panes(2, 0)
    workbook.close()


def build_html(csv_text: str, results_text: str, guide: str) -> None:
    payload = json.dumps({
        "csv": csv_text,
        "results": results_text,
        "guide": guide,
        "xlsx": base64.b64encode((ROOT / f"{NAME}.xlsx").read_bytes()).decode(),
    }, ensure_ascii=False).replace("<", "\\u003c")
    guide_html = markdown.markdown(guide, extensions=["tables", "fenced_code"])
    html = (ROOT / "page.template.html").read_text()
    html = html.replace("{{GUIDE}}", guide_html).replace("{{PAYLOAD}}", payload)
    (ROOT / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    rows = [formula_row(i + 2, *sample) for i, sample in enumerate(SAMPLES)]
    expected = example_results()
    guide = (ROOT / GUIDE).read_text(encoding="utf-8")
    csv_text = write_csv(ROOT / f"{NAME}.csv", rows)
    results_text = write_csv(ROOT / "9Sig_Example_Results.csv", expected)
    build_workbook(rows, expected, guide)
    build_html(csv_text, results_text, guide)
    with ZipFile(ROOT / "9Sig_Template_Package.zip", "w", ZIP_DEFLATED) as package:
        for filename in (f"{NAME}.csv", f"{NAME}.xlsx", "9Sig_Example_Results.csv", GUIDE, "index.html"):
            package.write(ROOT / filename, filename)
    print("Built CSV, XLSX, numerical example, standalone HTML, and ZIP.")


if __name__ == "__main__":
    main()
