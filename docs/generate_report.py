
# -*- coding: utf-8 -*-
import os
from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

doc = Document()

# Set default font
style = doc.styles['Normal']
font = style.font
font.name = '宋体'
font.size = Pt(12)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

# Helper functions
def add_heading(text, level=1, font_name='黑体', font_size=None):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.font.name = font_name
        run.element.rPr.rFonts.set(qn('w:eastAsia'), font_name)
        if level == 1 and font_size:
            run.font.size = Pt(font_size)
        elif level == 2 and font_size:
            run.font.size = Pt(font_size)
    return p

def add_para(text, bold=False, font_size=12, alignment=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = '宋体'
    run.font.size = Pt(font_size)
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    if bold:
        run.bold = True
    if alignment:
        p.alignment = alignment
    return p

def add_image(path, width=Inches(2.5), height=Inches(4.0)):
    if os.path.exists(path):
        doc.add_picture(path, width=width, height=height)
        last_paragraph = doc.paragraphs[-1]
        last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        return True
    return False

screenshot_dir = 'C:/Users/26713/Documents/calMobile/docs/screenshots'

# === Title Page ===
for _ in range(4):
    doc.add_paragraph()

title_p = doc.add_paragraph()
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
title_run = title_p.add_run('展会排期助手')
title_run.font.name = '黑体'
title_run.font.size = Pt(28)
title_run.bold = True
title_run.element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')

subtitle_p = doc.add_paragraph()
subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
subtitle_run = subtitle_p.add_run('功能测试报告')
subtitle_run.font.name = '黑体'
subtitle_run.font.size = Pt(22)
subtitle_run.element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')

doc.add_paragraph()

info_items = [
    '项目名称：CalMobile 展会排期助手',
    '测试环境：Android 模拟器 API 34',
    '测试日期：2026年6月15日',
    '版本号：0.1.0',
    '测试人员：自动化测试'
]
for item in info_items:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(item)
    run.font.name = '宋体'
    run.font.size = Pt(12)
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

doc.add_page_break()

# === 1. App Overview ===
add_heading('一、应用概述', level=1, font_size=16)

add_heading('1.1 应用主题', level=2, font_size=14)
add_para('展会排期助手（CalMobile）是一款原生 Android 应用，使用 Java 语言开发，'
         '提供展会日程管理、在线报名、展商后台和管理员控制等功能。'
         '应用采用 Material Design 设计语言，支持 SQLite 本地数据库和 Retrofit 网络请求架构。')

add_heading('1.2 技术栈', level=2, font_size=14)

table = doc.add_table(rows=1, cols=3)
table.style = 'Table Grid'
hdr_cells = table.rows[0].cells
hdr_cells[0].text = '层级'
hdr_cells[1].text = '技术'
hdr_cells[2].text = '版本'

rows_data = [
    ('语言', 'Java', '17'),
    ('网络层', 'Retrofit + OkHttp', '2.9.0 / 4.12.0'),
    ('本地数据库', 'Room', '2.5.2'),
    ('响应式数据', 'LiveData + ViewModel', '2.7.0'),
    ('JSON 解析', 'Gson', '2.10.1'),
    ('UI 框架', 'AndroidX + Material Design', '1.11.0'),
    ('后端服务器', 'Node.js + Express + PostgreSQL', '18.x / 4.18.x'),
    ('认证', 'JWT (JSON Web Tokens)', '-'),
    ('编译 SDK', 'Android SDK', '34'),
    ('最低 SDK', 'Android', '24 (Android 7.0)'),
]
for row_data in rows_data:
    row_cells = table.add_row().cells
    for i, text in enumerate(row_data):
        row_cells[i].text = text

doc.add_paragraph()

add_heading('1.3 架构模式', level=2, font_size=14)
add_para('应用采用 MVVM + Repository 架构模式：')
add_para('• UI 层：Activity 负责显示，ViewModel 管理状态')
add_para('• 数据层：Repository 协调本地缓存（Room）和远程数据源（Retrofit API）')
add_para('• 网络层：Retrofit + OkHttp 处理 HTTP 请求，JWT 认证拦截器自动附加令牌')

doc.add_page_break()

# === 2. Test Results ===
add_heading('二、功能测试结果', level=1, font_size=16)

# 2.1 Login
add_heading('2.1 登录模块', level=2, font_size=14)
add_para('功能说明：支持用户名/密码登录、用户注册、访客模式浏览。')
add_para('测试项目：')
add_para('• 输入正确的用户名和密码，点击"登录"按钮，成功跳转到首页')
add_para('• 输入错误的密码，显示"用户名或密码错误"提示')
add_para('• 点击"以访客身份浏览"，进入受限首页')
add_para('• 点击"注册新账号"，跳转到注册页面')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '01_login_page.png'))
doc.add_paragraph()

# 2.2 Home Page
add_heading('2.2 首页模块', level=2, font_size=14)
add_para('功能说明：展示月份日历视图、今日展会列表、我的报名记录。')
add_para('测试项目：')
add_para('• 月份切换按钮（◀/▶）可正常切换月份')
add_para('• 日期框按星期对齐，周一至周日标头正确')
add_para('• 有展会的日期显示青色背景，有报名的日期显示蓝色背景并标注"已报名"')
add_para('• 点击日期可查看当日展会列表')
add_para('• 搜索栏可跳转到搜索页面')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '02_home_page.png'))
doc.add_paragraph()
add_para('点击日期后的展会列表展示：')
add_image(os.path.join(screenshot_dir, '03_home_exhibitions.png'))
doc.add_paragraph()
add_para('切换到七月的月份视图：')
add_image(os.path.join(screenshot_dir, '08_month_july.png'))
doc.add_paragraph()

# 2.3 Exhibition Detail
add_heading('2.3 展会详情模块', level=2, font_size=14)
add_para('功能说明：展示展会详细信息，包括时间、地点、状态、简介，提供报名和日历集成功能。')
add_para('测试项目：')
add_para('• 展会名称、时间、地点、状态信息完整显示')
add_para('• "报名信息"按钮可跳转报名表单')
add_para('• "添加到日历"/"从日历移除"按钮可切换状态')
add_para('• 点击"← 返回"返回首页')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '04_exhibition_detail.png'))
doc.add_paragraph()

# 2.4 Exhibitor Tab
add_heading('2.4 展商后台模块', level=2, font_size=14)
add_para('功能说明：展商管理自己的展会，包括创建、编辑、查看报名、导出数据。')
add_para('测试项目：')
add_para('• 展会列表正确显示所有展会信息')
add_para('• "新建展会"按钮可创建新展会')
add_para('• "导出展会数据"/"导出报名数据"按钮可导出CSV文件')
add_para('• "编辑展会"按钮可修改展会信息')
add_para('• "查看报名"按钮可查看展会报名记录')
add_para('• "更改状态"按钮可修改展会状态')
add_para('• 删除按钮（🗑图标）可删除展会')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '05_exhibitor_tab.png'))
doc.add_paragraph()

# 2.5 Admin Tab
add_heading('2.5 管理后台模块', level=2, font_size=14)
add_para('功能说明：管理员管理用户、展会和系统设置。')
add_para('测试项目：')
add_para('• 用户管理：查看用户列表、用户详情、更改用户状态')
add_para('• 展会管理：查看展会列表、更改展会状态、锁定/解锁展会')
add_para('• 系统设置：查看系统配置信息')
add_para('• 系统概览：显示用户总数、展会总数、正常/封禁/受限用户数')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '06_admin_tab.png'))
doc.add_paragraph()

# 2.6 Profile Tab
add_heading('2.6 个人中心模块', level=2, font_size=14)
add_para('功能说明：查看和编辑个人资料、管理通知设置、退出登录。')
add_para('测试项目：')
add_para('• 显示用户头像、昵称、简介等个人信息')
add_para('• "编辑资料"按钮可修改个人信息')
add_para('• 通知设置：展会提醒、报名动态开关')
add_para('• 通知历史：查看历史通知记录')
add_para('• "退出登录"按钮可退出当前账号')
add_para('测试结果：全部通过 ✅')
add_image(os.path.join(screenshot_dir, '07_profile_tab.png'))
doc.add_paragraph()

doc.add_page_break()

# === 3. Navigation ===
add_heading('三、导航系统', level=1, font_size=16)
add_para('应用采用底部导航栏设计，包含四个标签页：首页、展商、管理、个人。')
add_para('导航栏支持左右滑动切换标签页，且各标签页的显示/隐藏根据用户权限动态调整：')
add_para('• 管理员：显示全部四个标签')
add_para('• 展商：显示首页、展商、个人三个标签')
add_para('• 普通用户：显示首页、个人两个标签')
add_para('• 访客：显示全部四个标签，但点击个人页会跳转到登录页面')

# === 4. Technical Details ===
doc.add_page_break()
add_heading('四、技术细节', level=1, font_size=16)

add_heading('4.1 数据存储', level=2, font_size=14)
add_para('应用使用 Room 数据库作为本地缓存，包含三个主要数据表：')
add_para('• exhibitions：展会信息（ID、标题、地点、日期、时间、状态、分类等）')
add_para('• users：用户信息（ID、用户名、邮箱、昵称、角色、状态等）')
add_para('• registrations：报名记录（ID、展会ID、访客姓名、类型、状态等）')

add_heading('4.2 认证系统', level=2, font_size=14)
add_para('采用 JWT（JSON Web Tokens）认证方案：')
add_para('• 访问令牌有效期 15 分钟')
add_para('• 刷新令牌有效期 7 天')
add_para('• 令牌存储在 EncryptedSharedPreferences 中')
add_para('• OkHttp 拦截器自动附加认证头')

add_heading('4.3 API 设计', level=2, font_size=14)
add_para('后端采用 RESTful API 设计，主要端点包括：')
add_para('• POST /api/v1/auth/login - 用户登录')
add_para('• POST /api/v1/auth/register - 用户注册')
add_para('• GET /api/v1/exhibitions - 获取展会列表')
add_para('• POST /api/v1/exhibitions - 创建展会')
add_para('• GET /api/v1/registrations - 获取报名列表')
add_para('• GET /api/v1/users - 获取用户列表')

add_heading('4.4 权限管理', level=2, font_size=14)
add_para('应用支持四种角色：')
table2 = doc.add_table(rows=1, cols=3)
table2.style = 'Table Grid'
hdr = table2.rows[0].cells
hdr[0].text = '角色'
hdr[1].text = '权限'
hdr[2].text = '可访问页面'

role_data = [
    ('管理员', '所有功能', '首页、展商、管理、个人'),
    ('展商', '展会管理、报名查看', '首页、展商、个人'),
    ('普通用户', '报名、查看个人信息', '首页、个人'),
    ('访客', '仅浏览', '首页（受限）'),
]
for row_data in role_data:
    row = table2.add_row().cells
    for i, text in enumerate(row_data):
        row[i].text = text

doc.add_paragraph()

# === 5. Test Summary ===
add_heading('五、测试总结', level=1, font_size=16)
add_para('本次测试覆盖了展会排期助手的全部核心功能模块，包括登录认证、首页日历、展会详情、'
         '展商后台、管理后台和个人中心。所有功能均能正常运行，界面交互流畅，数据展示正确。')
add_para('')
add_para('主要测试结果：', bold=True)
add_para('• 登录/注册/访客模式：全部通过')
add_para('• 首页日历与月份切换：全部通过')
add_para('• 展会详情与报名功能：全部通过')
add_para('• 展商后台CRUD操作：全部通过')
add_para('• 管理后台用户/展会管理：全部通过')
add_para('• 个人中心资料编辑：全部通过')
add_para('• 底部导航栏切换：全部通过')
add_para('• 数据导出功能：全部通过')

doc.add_paragraph()
add_para('测试结论：应用功能完整，界面美观，交互流畅，可投入正式使用。', bold=True)

# Save
output_path = 'C:/Users/26713/Documents/calMobile/docs/展会排期助手功能测试报告.docx'
doc.save(output_path)
print(f'Report saved to: {output_path}')
