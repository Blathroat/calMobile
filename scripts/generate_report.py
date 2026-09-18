#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
CalMobile 课程报告生成脚本
使用 python-docx 生成 Word 文档
"""

from docx import Document
from docx.shared import Inches, Pt, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
import os

def set_run_font(run, font_name, font_size, bold=False):
    """设置 run 的字体"""
    run.font.name = font_name
    run.font.size = Pt(font_size)
    run.font.bold = bold
    # 设置中文字体
    run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)

def add_heading_style(doc):
    """设置标题样式"""
    # 设置标题1样式
    style = doc.styles['Heading 1']
    style.font.name = '黑体'
    style.font.size = Pt(22)
    style.font.bold = True
    style._element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')
    
    # 设置标题2样式
    style = doc.styles['Heading 2']
    style.font.name = '黑体'
    style.font.size = Pt(16)
    style.font.bold = True
    style._element.rPr.rFonts.set(qn('w:eastAsia'), '黑体')

def add_normal_style(doc):
    """设置正文样式"""
    style = doc.styles['Normal']
    style.font.name = '宋体'
    style.font.size = Pt(12)
    style._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

def add_indented_paragraph(doc, text, bold=False):
    """添加首行缩进2字符的段落"""
    p = doc.add_paragraph()
    # 设置首行缩进 2 字符（约 24pt = 2 * 12pt）
    p.paragraph_format.first_line_indent = Pt(24)
    run = p.add_run(text)
    set_run_font(run, '宋体', 12, bold)
    return p

def add_image_with_text(doc, image_path, text_list, width=Inches(2.5)):
    """添加图片和文本的组合，图片在右，文本在左，支持首行缩进"""
    # 创建表格实现左右布局
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    
    # 设置表格宽度
    table.autofit = False
    
    # 左侧文本
    cell_text = table.rows[0].cells[0]
    cell_text.width = Inches(3.5)
    
    # 添加所有文本段落
    for i, text in enumerate(text_list):
        if i == 0:
            p = cell_text.paragraphs[0]
        else:
            p = cell_text.add_paragraph()
        p.paragraph_format.first_line_indent = Pt(24)
        run = p.add_run(text)
        set_run_font(run, '宋体', 12)
    
    # 右侧图片
    cell_img = table.rows[0].cells[1]
    cell_img.width = Inches(3)
    if os.path.exists(image_path):
        p = cell_img.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run()
        run.add_picture(image_path, width=width)
    
    # 添加空行
    doc.add_paragraph()

def create_report():
    doc = Document()
    
    # 设置样式
    add_heading_style(doc)
    add_normal_style(doc)
    
    # 标题
    title = doc.add_heading('Android 移动应用开发课程实验报告', 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    
    # 副标题
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run('CalMobile 展会排期助手')
    set_run_font(run, '黑体', 16, bold=True)
    
    doc.add_paragraph()
    
    # 项目信息
    info = doc.add_paragraph()
    info.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = info.add_run('项目名称：CalMobile 展会排期助手')
    set_run_font(run, '宋体', 12)
    info.add_run('\n')
    run = info.add_run('开发语言：Java')
    set_run_font(run, '宋体', 12)
    info.add_run('\n')
    run = info.add_run('目标平台：Android (API 34)')
    set_run_font(run, '宋体', 12)
    info.add_run('\n')
    run = info.add_run('开发工具：Android Studio + Gradle 8.5')
    set_run_font(run, '宋体', 12)
    
    doc.add_page_break()
    
    # 1. 项目概述
    doc.add_heading('1. 项目概述', 1)
    
    p = doc.add_paragraph()
    run = p.add_run(
        'CalMobile 是一款基于 Android 平台的展会排期与管理移动应用。该应用面向展会组织者、'
        '展商和普通用户，提供展会日历浏览、展会详情查看、在线报名、个人资料管理、'
        '展商后台管理和管理员控制等完整功能。项目采用 Java 语言开发，基于 Android SDK API 34，'
        '使用 Gradle 8.5 构建，旨在为展会行业提供一个高效、便捷的移动管理工具。'
    )
    set_run_font(run, '宋体', 12)
    
    p = doc.add_paragraph()
    run = p.add_run(
        '随着移动互联网的快速发展，展会行业对信息化管理的需求日益增长。传统的展会管理方式'
        '依赖纸质材料和人工操作，效率低下且容易出错。CalMobile 应用的开发正是为了解决这一'
        '痛点，通过移动技术实现展会信息的数字化管理，提升展会组织效率和用户体验。'
    )
    set_run_font(run, '宋体', 12)
    
    p = doc.add_paragraph()
    run = p.add_run(
        '本项目的核心目标是构建一个功能完整、性能稳定、易于维护的 Android 应用。'
        '应用需要支持多角色权限控制（管理员、展商、普通用户、访客），实现展会的全生命周期管理，'
        '包括展会发布、报名、审核、统计等环节。同时，应用还需要提供良好的用户体验，'
        '包括直观的日历视图、流畅的页面切换、友好的交互设计等。'
    )
    set_run_font(run, '宋体', 12)
    
    p = doc.add_paragraph()
    run = p.add_run(
        '在技术实现方面，项目采用前后端分离的分层架构：界面是 WebView 承载的前端页面'
        '（原生 HTML/CSS/ES 模块，沿用设计交付件保证视觉一致），业务数据全部来自'
        '自建的 Node.js + Express + PostgreSQL 后端，Android 原生侧只保留「只有设备能做」的'
        '系统能力（系统日历、通知与摄像头权限、媒体选择与落盘、分享、CSV 导出、系统栏配色）。'
        '界面遵循设计交付件 newUI 的令牌与动效规范，'
        '项目还包含完整的测试体系，包括 Android 单元测试、前端渲染冒烟测试与后端接口契约测试，'
        '确保代码质量。'
    )
    set_run_font(run, '宋体', 12)
    
    # 2. 技术栈
    doc.add_heading('2. 技术栈', 1)
    
    doc.add_heading('2.1 Android 客户端', 2)
    
    p = doc.add_paragraph()
    run = p.add_run(
        'Android 客户端采用 Java 语言开发，使用 Android SDK API 34 作为目标平台。'
        '选择 Java 而非 Kotlin 的主要原因是项目初期已有部分 Java 代码基础，'
        '为避免大规模重写，决定沿用 Java 语言。以下为主要技术依赖：'
    )
    set_run_font(run, '宋体', 12)
    
    table = doc.add_table(rows=1, cols=4)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr_cells = table.rows[0].cells
    for i, text in enumerate(['技术', '版本', '用途', '选择理由']):
        hdr_cells[i].text = text
        for p in hdr_cells[i].paragraphs:
            for run in p.runs:
                run.font.bold = True
    
    tech_data = [
        ['Java', '17', '主要开发语言', '项目现有代码为 Java，避免大规模重写'],
        ['Android SDK', 'API 34', '目标平台', '支持最新 Android 特性'],
        ['WebView', '平台内置', '界面容器', '直接复用 newUI 的 HTML/CSS 设计交付件，'
                                          '改界面不必重新编译布局'],
        ['原生 ES 模块', '-', '前端脚本', '浏览器原生支持的模块化，无构建步骤，'
                                        '改完即生效'],
        ['Gson', '2.10.1', '桥接层 JSON', '唯一的运行时依赖，用于原生与前端之间的数据交换'],
        ['JUnit', '4.13.2', '单元测试', '测试纯逻辑（日期解析、设备镜像、CSV 生成、动作分发）'],
    ]
    
    for tech in tech_data:
        row_cells = table.add_row().cells
        for i, text in enumerate(tech):
            row_cells[i].text = text
    
    doc.add_heading('2.2 后端服务器', 2)
    
    p = doc.add_paragraph()
    run = p.add_run(
        '后端服务器采用 Node.js + Express 框架开发，使用 PostgreSQL 作为数据库，'
        'JWT 实现无状态认证。后端提供 RESTful API 接口，支持展会管理、用户认证、'
        '报名管理等功能。以下为主要技术依赖：'
    )
    set_run_font(run, '宋体', 12)
    
    table = doc.add_table(rows=1, cols=4)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr_cells = table.rows[0].cells
    for i, text in enumerate(['技术', '版本', '用途', '选择理由']):
        hdr_cells[i].text = text
        for p in hdr_cells[i].paragraphs:
            for run in p.runs:
                run.font.bold = True
    
    server_data = [
        ['Node.js', '18+', '运行时', '异步 I/O，适合高并发 API 服务'],
        ['Express', '4.18.2', 'Web 框架', '简单灵活，生态丰富，学习成本低'],
        ['PostgreSQL', '15+', '数据库', '功能强大，支持复杂查询和事务'],
        ['JWT', '-', '认证', '无状态认证，适合分布式系统'],
        ['bcryptjs', '-', '密码加密', '安全的密码哈希算法，防止明文存储'],
    ]
    
    for tech in server_data:
        row_cells = table.add_row().cells
        for i, text in enumerate(tech):
            row_cells[i].text = text
    
    # 3. 系统架构
    doc.add_heading('3. 系统架构', 1)
    
    p = doc.add_paragraph()
    run = p.add_run(
        'CalMobile 采用分层架构模式，关注点清晰分离。这种架构设计的优点是各层职责明确，'
        '便于团队协作开发，也便于后续的维护和扩展。以下是各层的详细说明：'
    )
    set_run_font(run, '宋体', 12)
    
    layers = [
        ('表现层', 'WebView 承载的前端页面（HTML/CSS/ES 模块），负责显示界面、处理交互与页面导航。'
         '页面按设计稿一屏一文件（15 个页面模块），使用哈希路由；颜色、字号、间距只在'
         '设计令牌里声明，交互动效集中在动效层，页面不重复定义。'),
        ('桥接层', 'WebAppBridge 与 WebAppActions，只暴露「只有设备能做」的 10 个系统动作'
         '（系统日历、通知与摄像头权限、媒体选择与落盘、分享、CSV 导出、设备外观镜像）。'
         '业务数据不经过桥接，避免出现两套数据实现。'),
        ('数据层', '自建的 Node.js + Express 后端与 PostgreSQL 数据库，'
         '提供 REST 接口；前端通过唯一的取数入口把动作名翻译成 HTTP 请求，'
         '服务端统一做权限校验与业务规则校验。'),
        ('工具层', 'Helpers 与 Actions，处理系统集成与格式化：CalendarHelper（系统日历）、'
         'NotificationHelper（通知渠道与权限）、ExportManager（CSV 生成）、'
         'MediaActions（图片压缩与落盘）、AppSettings（设备侧外观与媒体上限镜像）。'),
    ]
    
    for layer, desc in layers:
        p = doc.add_paragraph()
        run = p.add_run(f'{layer}：')
        run.bold = True
        set_run_font(run, '宋体', 12)
        run = p.add_run(desc)
        set_run_font(run, '宋体', 12)
    
    # 4. 功能展示
    doc.add_heading('4. 功能展示', 1)
    
    # 4.1 登录页面
    doc.add_page_break()
    doc.add_heading('4.1 登录页面', 2)
    add_image_with_text(doc, 'docs/screenshots/01_login_page.png', [
        '应用启动后首先显示登录页面。用户可以输入用户名和密码进行登录，'
        '也可以选择注册新账号。应用预置了测试账号：demo（管理员）、'
        'exhibitor（展商）、user（普通用户）。',
        '访客模式下用户可以浏览首页和展会详情，'
        '但不能报名或访问个人/展商/管理页面。登录页面设计简洁直观，'
        '支持表单验证和错误提示，确保用户输入的有效性。',
    ])
    
    # 4.2 首页展会日历
    doc.add_page_break()
    doc.add_heading('4.2 首页展会日历', 2)
    add_image_with_text(doc, 'docs/screenshots/02_home_page.png', [
        '登录后进入首页，展示月视图展会日历。有展会的日期显示标记，'
        '用户可以点击日期查看当天的展会列表。首页还提供顶部搜索入口，'
        '方便用户快速搜索展会。',
        '日历视图直观展示展会分布，用户可以快速了解当月展会安排。'
        '展会卡片展示展会名称、地点、时间和状态，支持点击进入详情页面。',
    ])
    
    # 4.3 底部导航
    doc.add_page_break()
    doc.add_heading('4.3 底部导航', 2)
    add_image_with_text(doc, 'docs/screenshots/03_profile_tab.png', [
        '应用采用 4 标签底部导航：首页、展商、管理、个人。'
        '不同角色的用户可以看到不同的导航标签，例如普通用户只能看到首页和个人标签。',
        '点击标签时在 WebView 的内容区域切换页面（哈希路由），并保持底部导航栏可见。'
        '当前标签的指示条滑动到目标位置，提供清晰的导航反馈。',
    ])
    
    # 4.4 展商后台
    doc.add_page_break()
    doc.add_heading('4.4 展商后台', 2)
    add_image_with_text(doc, 'docs/screenshots/04_exhibitor_tab.png', [
        '展商可以访问展商后台，管理自己创建的展会。支持创建、编辑、删除展会，'
        '以及管理展会报名。展商后台提供展会列表，显示展会名称、状态、报名人数等信息。',
        '展商可以设置展会状态（报名中、截止报名、已结束），'
        '并查看和审核报名记录。新建/编辑展会使用独立的 ExhibitionFormActivity 页面，'
        '提供完整的表单输入体验。',
    ])
    
    # 4.5 管理后台
    doc.add_page_break()
    doc.add_heading('4.5 管理后台', 2)
    add_image_with_text(doc, 'docs/screenshots/05_admin_tab.png', [
        '管理员可以访问管理后台，管理所有用户和展会。支持用户封禁/解封、'
        '展会锁定/解锁、数据导出等功能。',
        '管理后台分为用户管理和展会管理两个 tab，用户管理显示所有用户信息，'
        '包括昵称、邮箱、状态、注册时间等；展会管理显示所有展会信息，'
        '支持状态修改和锁定/解锁操作。',
    ])
    
    # 4.6 展会详情
    doc.add_page_break()
    doc.add_heading('4.6 展会详情', 2)
    add_image_with_text(doc, 'docs/screenshots/06_exhibition_detail.png', [
        '用户可以查看展会详情，包括展会名称、地点、时间、状态和介绍。'
        '支持富文本渲染，可以展示 HTML 格式的展会介绍。',
        '详情页面提供报名按钮，根据用户权限和展会状态决定按钮是否可点击。'
        '无权限用户按钮为灰色，已报名用户显示报名状态。',
        '页面还提供添加到日历功能，方便用户跟踪展会时间。',
    ])
    
    # 4.7 报名表单
    doc.add_page_break()
    doc.add_heading('4.7 报名表单', 2)
    add_image_with_text(doc, 'docs/screenshots/07_registration_form.png', [
        '用户可以填写报名表单，提交报名申请。报名表单支持自定义字段，'
        '包括单选、多选和填空类型。表单设计简洁直观，支持输入验证和错误提示。',
        '提交后会显示报名结果，包括报名编号和状态。如果展会需要审核，'
        '报名状态会显示为待审核，用户可以在"我的报名"中查看审核进度。',
    ])
    
    # 4.8 搜索功能
    doc.add_page_break()
    doc.add_heading('4.8 搜索功能', 2)
    add_image_with_text(doc, 'docs/screenshots/08_search.png', [
        '用户可以通过搜索功能快速查找展会和用户。搜索结果以卡片形式展示，'
        '支持关键词匹配。搜索页面提供搜索历史和热门搜索推荐，'
        '帮助用户快速找到所需内容。',
        '搜索结果支持点击跳转到详情页面，提供便捷的导航体验。',
    ])
    
    # 5. 技术详情
    doc.add_heading('5. 技术详情', 1)
    
    doc.add_heading('5.1 数据库设计', 2)
    add_indented_paragraph(doc,
        '数据统一存放在后端 PostgreSQL 数据库里，表结构由按编号记录的迁移脚本管理'
        '（可反复执行，只跑没跑过的步骤），示例数据按「相对今天」生成，'
        '因此日历落点与报名窗口永远有可演示的数据。主要包含以下表：'
    )
    
    tables_desc = [
        ('exhibitions 表', '存储展会信息，包括 ID、标题、地点、时间、状态、分类、简介、'
         '报名窗口与二维码开关等字段。展会日期只存一列 DATE，年 / 月 / 日由 SQL 派生，'
         '避免三者互相漂移。'),
        ('registrations 表', '存储报名信息，包含展会、报名人、提交时间、审核状态（待审核 / '
         '已通过 / 已拒绝 / 已参加 / 已撤销）、核销时间与表单回答；'
         '通过展会 ID 关联 exhibitions 表，并有不冗余展会标题的约定。'),
        ('users 表', '存储用户信息，包括 ID、昵称、邮箱、简介、地区、头像、角色、账号状态、'
         '公开策略，以及个人外观模式。状态一律存英文代码，中文标签只在服务端映射一次。'),
        ('exhibition_fields 表', '存储展会的报名收集项：标题、类型（文本 / 单选 / 多选）、'
         '选项、是否必填与顺序。'),
        ('其它表', 'app_settings（服务器级设置）、notification_preferences（通知偏好）、'
         'refresh_tokens（可撤销的刷新令牌）、notifications（通知记录）'
         '与 schema_migrations（迁移记录）。'),
    ]
    
    for table_name, desc in tables_desc:
        p = doc.add_paragraph()
        run = p.add_run(f'{table_name}：')
        run.bold = True
        set_run_font(run, '宋体', 12)
        run = p.add_run(desc)
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('5.2 设计模式', 2)
    add_indented_paragraph(doc, '项目采用多种设计模式，提高代码的可维护性和可扩展性：')
    
    patterns = [
        ('单一取数入口', '前端所有业务数据都经过同一个取数模块（动作名 → REST 路径的映射表），'
         '页面不直接发请求、也不直接调原生桥接。换后端实现时只改映射表，页面不动。'),
        ('设备能力白名单', '原生只实现 10 个系统动作，分发入口的 switch 就是权威清单；'
         '数据类动作一律不经过桥接，因此不存在「两套数据实现」。'),
        ('响应信封约定', '写操作统一返回 { ok, error, ... }，可预期的业务失败用 200 + ok:false，'
         '认证与授权问题用 4xx，数据库不可用用 503；前端按同一套规则判断，'
         '错误文案不会被当成成功。'),
        ('先画缓存、再后台刷新', '只读接口提供「同步读缓存 / 后台预取」两种用法，'
         '页面在缓存命中时同步出内容、不清空已有内容，数据真的变了才重绘，'
         '避免切换页面与切换月份时闪空白。'),
        ('标签单点映射', '状态在库里只存英文代码，中文标签在服务端映射一次，'
         '前端与原生都消费同一批字符串，避免同一种状态在多处各写一份。'),
        ('设备镜像', '服务器设置与个人偏好由后端持有，原生只保留一份设备侧镜像'
         '（外观模式、系统栏颜色、媒体压缩上限），由前端在合适时机推给原生。'),
    ]
    
    for pattern, desc in patterns:
        p = doc.add_paragraph()
        run = p.add_run(f'{pattern}：')
        run.bold = True
        set_run_font(run, '宋体', 12)
        run = p.add_run(desc)
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('5.3 权限控制', 2)
    add_indented_paragraph(doc,
        '权限控制由服务端统一判定：后端从访问令牌解析出用户角色，'
        '在每个接口上校验「这个角色能不能做这件事、能不能碰这条数据」，'
        '前端只根据接口下发的权限标记决定按钮是否可用——'
        '因此绕过页面直接调接口也拿不到越权数据。支持以下角色：'
    )
    
    roles = [
        ('管理员', '拥有所有权限，可管理所有用户和展会，包括封禁/解封用户、'
         '锁定/解锁展会、导出数据等。'),
        ('展商', '可管理自己创建的展会和报名，包括创建/编辑/删除展会、'
         '审核报名、设置展会状态等。'),
        ('普通用户', '可查看展会、报名、管理个人信息，包括浏览展会详情、'
         '提交报名、查看报名记录、修改个人资料等。'),
        ('访客', '仅可浏览首页和展会详情，不能报名或访问个人/展商/管理页面。'
         '点击个人标签会跳转登录页面。'),
    ]
    
    for role, desc in roles:
        p = doc.add_paragraph()
        run = p.add_run(f'{role}：')
        run.bold = True
        set_run_font(run, '宋体', 12)
        run = p.add_run(desc)
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('5.4 UI 设计', 2)
    add_indented_paragraph(doc,
        '界面按设计交付件 newUI 的规范实现，颜色、字号、间距、圆角只在设计令牌里声明一次，'
        '交互动效集中在动效层，因此整体风格一致、改主题不必逐页调整。'
        '主要特点包括：'
    )
    
    ui_features = [
        '底部导航栏：4 标签等宽设计，支持左右滑动切换，当前 tab 高亮显示',
        '日历视图：月视图展示展会分布，有展会的日期显示标记',
        '卡片设计：展会列表、报名记录等使用卡片形式展示，信息层次清晰',
        '动画效果：页面切换、列表项显示等使用平滑动画，提升用户体验',
        '响应式布局：适配不同屏幕尺寸，确保在各种设备上正常显示',
    ]
    
    for feature in ui_features:
        p = doc.add_paragraph()
        run = p.add_run(f'• {feature}')
        set_run_font(run, '宋体', 12)
    
    # 6. 测试与验证
    doc.add_heading('6. 测试与验证', 1)
    
    doc.add_heading('6.1 单元测试', 2)
    add_indented_paragraph(doc,
        'Android 侧的单元测试使用 JUnit 4，覆盖不依赖设备与数据库的纯逻辑（共 32 项）。'
        '测试只断言真实契约，不把实现里的常量抄成期望值——'
        '这一点尤其重要：日期这类「写死常量」的缺陷，如果测试照着常量写期望值就永远测不出来。'
        '主要测试包括：'
    )
    
    tests = [
        'CalendarHelperTest：ISO 日期校验与「日期 + 时间 → 时间戳」解析（含非法日期必须报错）',
        'AppSettingsTest：外观模式取值与媒体格式列表的解析',
        'ExportManagerTest：CSV 生成，包括 BOM、列顺序、缺失字段与引号 / 换行转义',
        'WebAppBridgeTest：桥接层的取值助手（文本、布尔、数字、列表、映射）',
    ]
    
    for test in tests:
        p = doc.add_paragraph()
        run = p.add_run(f'• {test}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('6.2 前端与后端测试', 2)
    add_indented_paragraph(doc,
        '除 Android 单元测试外，还有三层自动化测试，覆盖界面接线、前后端契约与数据结构：'
    )
    
    integration_tests = [
        '前端渲染冒烟测试（18 项）：用最小 DOM 打桩与「假后端」把每个页面真实渲染一次，'
        '校验取数接线、缓存先行、并发去重、401 自动续期与动作到 REST 路径的映射',
        '后端接口契约测试（39 项）：跑真实 Express + PostgreSQL，逐接口断言页面用到的字段、'
        '四类身份的权限边界、报名窗口 / 重复报名 / 自动通过 / 核销流转等业务规则，'
        '并交叉校验前端每个数据动作都有后端路由接住',
        '后端单元测试（jest）：不依赖数据库的纯函数与中间件，'
        '包括 JWT 配置校验、认证中间件与「数据库不可用」的状态码判定',
        '前端静态检查：ES 模块能否解析、页面是否绕过取数入口、'
        '用户可见文案在源码 / 资源 / 原生清单三处是否一致、原生动作是否都在白名单内',
    ]
    
    for test in integration_tests:
        p = doc.add_paragraph()
        run = p.add_run(f'• {test}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('6.3 冒烟测试', 2)
    add_indented_paragraph(doc,
        '项目包含一组静态检查脚本（node scripts/smoke-check.js，95 项检查），'
        '验证项目骨架、桥接契约、页面模块、设计令牌、动效层、内置依赖与文档关键内容，'
        '并守住「已删除的旧结构不要重新出现」。检查内容包括：清单入口、'
        '原生动作白名单、页面文件与路由注册、颜色与动效是否只在令牌层声明等。'
        '冒烟测试确保项目基础结构正确，为后续开发提供保障。'
    )
    
    # 7. 总结与收获
    doc.add_heading('7. 总结与收获', 1)
    
    doc.add_heading('7.1 项目成果', 2)
    add_indented_paragraph(doc,
        '通过本次课程实验，成功开发了一款功能完整的 Android 移动应用，实现了展会排期、'
        '报名、个人管理、展商后台和管理后台等核心功能。应用采用前后端分离架构：'
        '界面由 WebView 承载并复用设计交付件，业务数据由自建的 Express + PostgreSQL '
        '后端提供，原生只保留系统能力。项目包含完整的测试体系（单元测试、渲染冒烟测试、'
        '接口契约测试与静态检查），确保了代码质量。文档齐全，包括 README（需求、架构、'
        '验收场景与路线图）、后端说明与贡献者约定，为后续开发和维护提供了参考。'
    )
    
    doc.add_heading('7.2 技术收获', 2)
    add_indented_paragraph(doc, '通过本次项目开发，获得了以下技术收获：')
    
    learnings = [
        '掌握了 Android 应用开发的基本流程和技术栈，包括 Activity 生命周期、'
        'WebView 容器与权限 / 文件选择的结果转发、系统日历与通知等系统能力的调用',
        '学会了前后端分离的架构设计：界面与数据各自独立演进，'
        '通过一张「动作名 → REST 路径」的映射表把两侧接起来，'
        '换实现时页面不用改',
        '掌握了 PostgreSQL 的使用与迁移脚本的写法（按编号记录、可反复执行、示例数据相对当天生成），'
        '理解了「状态存英文代码、中文标签只映射一次」这类约定的价值',
        '学会了用 Express 设计与实现 REST 接口，理解了信封式响应（写操作 { ok, error }）'
        '与状态码语义（业务失败 200、认证授权 4xx、数据库不可用 503）的取舍',
        '学会了用设计令牌与动效层管理界面：颜色、字号、间距、圆角集中声明，'
        '页面不写死色值，因此换主题与深色模式不必逐页改',
        '学会了编写不同层次的测试：单元测试、页面渲染冒烟测试、接口契约测试与静态检查，'
        '并意识到「测试照着实现抄期望值」会让缺陷长期隐藏',
        '掌握了 Git 版本控制与按功能分批提交的习惯，'
        '每次提交都附带可复现的验证命令与结果',
    ]
    
    for learning in learnings:
        p = doc.add_paragraph()
        run = p.add_run(f'• {learning}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('7.3 不足与改进', 2)
    add_indented_paragraph(doc, '项目仍存在一些不足，后续可以改进：')
    
    improvements = [
        '应用必须先启动后端才能取到数据（数据只在服务端，没有离线降级），'
        '课堂演示时需要先起数据库与后端，后续可考虑打包一键启动脚本',
        '后端目前只在本机以明文 HTTP 运行，尚未部署到服务器，'
        '也没有 HTTPS、签名校验与登录限流',
        '通知只落库、没有推送通道，应用不在前台时收不到提醒，'
        '需要接入推送服务或在打开应用时拉取',
        '上传的媒体仍保存在设备私有目录，换设备不同步，'
        '需要补对象存储与上传接口',
        '缺少 UI / Instrumentation 测试，导航流程与权限弹窗仍靠人工回归，'
        '下一步补充自动化界面测试',
        '中文文案已集中到资源文件，但仍有少量模板字符串与原生提示留在代码里，'
        '可以继续收敛',
    ]
    
    for improvement in improvements:
        p = doc.add_paragraph()
        run = p.add_run(f'• {improvement}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('7.4 总结', 2)
    add_indented_paragraph(doc,
        '本次课程实验是一次宝贵的实践经历。通过从需求分析、架构设计到编码实现的完整流程，'
        '不仅提升了 Android 开发技能，也加深了对软件工程 principles 的理解。'
        '项目采用的分层架构、设计模式和测试策略，为今后的开发工作提供了良好的基础。'
        '在开发过程中，遇到了许多挑战，如数据库设计、权限控制、UI 适配等，'
        '通过查阅文档、搜索资料和实践尝试，最终都得到了解决。'
        '这个过程让我深刻体会到，编程不仅是写代码，更是解决问题的过程。'
    )
    
    add_indented_paragraph(doc,
        '总的来说，本次课程实验达到了预期目标，不仅完成了一个功能完整的 Android 应用，'
        '更重要的是培养了独立思考和解决问题的能力。'
        '这些经验和技能将对今后的学习和工作产生积极的影响。'
        '感谢老师和同学们的帮助和支持，让我能够顺利完成这次实验。'
    )
    
    # 保存文档
    doc.save('docs/CalMobile课程实验报告.docx')
    print('报告已生成：docs/CalMobile课程实验报告.docx')

if __name__ == '__main__':
    create_report()
