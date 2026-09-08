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
        '在技术实现方面，项目采用分层架构设计，将表现层、业务逻辑层、数据层和工具层清晰分离，'
        '确保代码的可维护性和可扩展性。数据存储使用 SQLite 本地数据库，提供数据的持久化和'
        '离线访问能力。UI 设计遵循 Material Design 规范，提供一致的用户体验。'
        '项目还包含完整的测试体系，包括单元测试、集成测试和冒烟测试，确保代码质量。'
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
        ['Room', '2.6.1', '本地数据库', 'Android 官方推荐，编译时验证，与 LiveData 无缝集成'],
        ['Retrofit', '2.9.0', '网络请求', 'Android 最成熟的网络库，类型安全，易于测试'],
        ['Glide', '4.16.0', '图片加载', '高效的图片加载和缓存，支持多种图片来源'],
        ['Material Design', '1.11.0', 'UI 组件', '官方设计规范，丰富的组件库，一致性好'],
        ['Gson', '2.10.1', 'JSON 解析', '简单易用，与 Retrofit 无缝集成'],
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
        ('表现层', 'Activity 和 XML 布局，负责显示 UI 元素、处理用户交互、页面间导航。'
         '所有 Activity 继承自 BaseActivity，复用通用的 UI 辅助方法，如 dp 转换、'
         '按钮样式、面板动画、导航过渡等。XML 布局文件定义了页面结构，'
         '支持响应式设计，适配不同屏幕尺寸。'),
        ('业务逻辑层', 'Manager 类，负责实现业务规则、协调数据操作、管理应用状态。'
         '主要包括 ExhibitionManager（展会管理）、RegistrationManager（报名管理）、'
         'AdminUserManager（用户管理）和 AuthManager（认证管理）。'
         '每个 Manager 封装了完整的业务逻辑，提供统一的数据操作接口。'),
        ('数据层', 'DatabaseHelper 和 Models，负责持久化数据、检索数据、管理数据库结构。'
         '使用 SQLite 作为本地数据库，通过 DatabaseHelper 单例管理数据库连接和操作。'
         'Models 定义了数据结构，包括 ExhibitorExhibition（展会）、'
         'Registration（报名）和 AdminUser（用户）。'),
        ('工具层', 'Helpers，提供通用功能、处理系统集成、格式化和显示数据。'
         '主要包括 NotificationHelper（通知管理）、CalendarHelper（日历集成）、'
         'ExportManager（数据导出）、RichTextViewer（富文本渲染）、'
         'GuestHelper（访客状态判断）和 PermissionHelper（角色权限校验）。'),
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
        '点击标签时在 MainActivity 内容容器中左右滑动切换，并保持底部导航栏可见。'
        '当前 tab 高亮跟随切换，提供清晰的导航反馈。',
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
        '应用使用 SQLite 本地数据库存储数据，通过 DatabaseHelper 单例管理数据库操作。'
        '数据库设计遵循第三范式，减少数据冗余。主要包含以下表：'
    )
    
    tables_desc = [
        ('exhibitions 表', '存储展会信息，包括 ID、标题、地点、时间、状态、描述、分类等字段。'
         '使用 TEXT 类型存储 ID，INTEGER 存储日期，TEXT 存储其他信息。'),
        ('registrations 表', '存储报名信息，包括展会信息、访客信息、状态等。'
         '与 exhibitions 表通过展会标题关联，支持多对多关系。'),
        ('users 表', '存储用户信息，包括 ID、昵称、邮箱、状态、注册时间、最后登录时间等。'
         '支持用户状态管理，包括正常、封禁、限制等状态。'),
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
        ('单例模式', 'DatabaseHelper、AuthManager、NotificationHelper 等使用单例模式，'
         '确保全局唯一实例，避免重复创建对象，节省系统资源。'),
        ('Manager 模式', 'ExhibitionManager、RegistrationManager 等封装业务逻辑，'
         '提供统一的数据操作接口。每个 Manager 负责一个业务领域，'
         '降低模块间的耦合度。'),
        ('双存储模式', '所有 Manager 同时支持 SQLite 和内存存储，'
         '提供数据持久化和内存缓存的双重保障。当数据库不可用时，'
         '自动降级到内存存储，确保应用可用性。'),
        ('模板方法模式', 'BaseActivity 提供通用 UI 操作的模板方法，'
         '如 dp 转换、按钮样式、面板动画等。子类可以复用和扩展这些方法，'
         '减少重复代码。'),
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
        '应用实现了基于角色的权限控制，通过 GuestHelper 和 PermissionHelper 实现。'
        'GuestHelper 提供 isGuest() 方法判断当前用户是否为访客状态；'
        'PermissionHelper 提供 hasPermission(String permission) 方法基于角色校验操作权限。'
        '支持以下角色：'
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
        '应用 UI 设计遵循 Material Design 规范，提供一致的用户体验。'
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
        '项目包含 14 个测试文件，覆盖核心业务逻辑。单元测试使用 JUnit 4 框架，'
        '测试各个 Manager 和 Helper 类的方法。测试覆盖率较高，'
        '确保了核心业务逻辑的正确性。主要测试包括：'
    )
    
    tests = [
        'AuthManagerTest：测试用户认证逻辑，包括登录、注册、登出等功能',
        'DatabaseHelperTest：测试数据库操作，包括 CRUD 操作和数据查询',
        'ExhibitionManagerTest：测试展会管理逻辑，包括增删改查和状态管理',
        'RegistrationManagerTest：测试报名管理逻辑，包括提交、取消、审核等',
        'AdminUserManagerTest：测试用户管理逻辑，包括状态修改和权限控制',
        'ExportManagerTest：测试数据导出功能，包括 CSV 格式生成',
        'NotificationHelperTest：测试通知功能，包括通知发送和权限管理',
        'CalendarHelperTest：测试日历集成，包括事件添加和移除',
        'RichTextViewerTest：测试富文本渲染，包括 HTML 解析和样式应用',
        'ExhibitorExhibitionTest：测试展会模型数据结构',
        'AdminUserTest：测试用户模型数据结构',
    ]
    
    for test in tests:
        p = doc.add_paragraph()
        run = p.add_run(f'• {test}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('6.2 集成测试', 2)
    add_indented_paragraph(doc,
        '项目包含 4 个集成测试，覆盖核心工作流。集成测试验证多个组件协作的正确性，'
        '确保业务流程的完整性。主要测试包括：'
    )
    
    integration_tests = [
        'ExhibitionWorkflowIntegrationTest：测试完整展会工作流，从创建到结束',
        'RegistrationWorkflowIntegrationTest：测试完整报名工作流，从提交到审核',
        'SearchWorkflowIntegrationTest：测试搜索功能，包括关键词匹配和结果展示',
        'UserManagementWorkflowIntegrationTest：测试用户管理工作流，包括状态修改',
    ]
    
    for test in integration_tests:
        p = doc.add_paragraph()
        run = p.add_run(f'• {test}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('6.3 冒烟测试', 2)
    add_indented_paragraph(doc,
        '项目包含 57 项静态检查，验证项目骨架、文档、导航、权限辅助类等。'
        '冒烟测试使用 Node.js 脚本实现，运行命令：node scripts/smoke-check.js。'
        '检查内容包括：项目结构完整性、关键文件存在性、代码内容验证等。'
        '冒烟测试确保项目基础结构正确，为后续开发提供保障。'
    )
    
    # 7. 总结与收获
    doc.add_heading('7. 总结与收获', 1)
    
    doc.add_heading('7.1 项目成果', 2)
    add_indented_paragraph(doc,
        '通过本次课程实验，成功开发了一款功能完整的 Android 移动应用，实现了展会排期、'
        '报名、个人管理、展商后台和管理后台等核心功能。应用采用分层架构设计，'
        '代码结构清晰，可维护性和可扩展性良好。项目包含完整的测试体系，'
        '确保了代码质量。文档齐全，包括 README、ARCHITECTURE、AGENT 等，'
        '为后续开发和维护提供了参考。'
    )
    
    doc.add_heading('7.2 技术收获', 2)
    add_indented_paragraph(doc, '通过本次项目开发，获得了以下技术收获：')
    
    learnings = [
        '掌握了 Android 应用开发的基本流程和技术栈，包括 Activity 生命周期、'
        'UI 布局、数据存储、网络请求等核心概念',
        '学会了分层架构设计，将表现层、业务逻辑层和数据层清晰分离，'
        '提高了代码的可维护性和可扩展性',
        '掌握了 SQLite 数据库的使用，实现了数据的本地持久化，'
        '理解了数据库设计和优化的基本原则',
        '学会了使用 Retrofit 进行网络请求，为后续 API 对接打下基础，'
        '理解了 RESTful API 设计原则',
        '掌握了 Material Design 组件的使用，提升了 UI 设计能力，'
        '学会了创建一致的用户体验',
        '学会了编写单元测试和集成测试，保证了代码质量，'
        '理解了测试驱动开发的重要性',
        '掌握了 Git 版本控制，学会了分支管理和代码审查，'
        '提高了团队协作能力',
    ]
    
    for learning in learnings:
        p = doc.add_paragraph()
        run = p.add_run(f'• {learning}')
        set_run_font(run, '宋体', 12)
    
    doc.add_heading('7.3 不足与改进', 2)
    add_indented_paragraph(doc, '项目仍存在一些不足，后续可以改进：')
    
    improvements = [
        '认证系统仍为内存存储，需要迁移到 SQLite 或安全存储，'
        '以支持数据持久化和多设备同步',
        '展会模型存在重复（MainActivity 内部 Exhibition 和 ExhibitorExhibition），'
        '需要统一数据源，避免数据不一致',
        '部分界面由 Java 动态创建，维护成本较高，'
        '建议将稳定结构迁移到 XML 布局',
        '缺少 UI/Instrumentation 测试，需要补充 Activity 和导航流程测试',
        '深色模式未支持，需要新增 values-night 资源，'
        '提升夜间使用体验',
        '部分中文文案硬编码在 Java/XML 中，不利于国际化，'
        '建议逐步迁移到 strings.xml',
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
