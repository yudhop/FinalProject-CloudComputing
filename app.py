import math
from flask import Flask, jsonify, render_template, request, session, Blueprint, redirect
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import json
from werkzeug.security import generate_password_hash, check_password_hash
import uuid
from datetime import date, datetime
from db import getdb
from functools import wraps
from sqlalchemy import text
from decimal import Decimal
import hashlib
import uuid
import midtransclient
import re
from recommender import SimpleRecommender
import os

snap = midtransclient.Snap(
    is_production=False,       # Sandbox
    server_key="Mid-server-1vyWJQ6aNqi7VBaNeLlj4Q35",
    client_key="Mid-client-8jxR4D7IkFDCgr7y"
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

CORS(app, supports_credentials=True)
driver_bp = Blueprint("driver", __name__)

BASE_DELIVERY_FEE = 5000
FEE_PER_KM = 2000
NIGHT_DELIVERY_FEE = 3000
NIGHT_START_HOUR = 22
NIGHT_END_HOUR = 6

# Konfigurasi Database
app.config["SQLALCHEMY_DATABASE_URI"] = "mysql+pymysql://admin_jawa:admin_jawa1@easyfood.mysql.database.azure.com/easyfood_db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

recommender = SimpleRecommender(db.session)

# --- MODELS ---
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    email = db.Column(db.String(100), unique=True)
    password = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=db.func.now())

class Store(db.Model):
    __tablename__ = "stores"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    logo = db.Column(db.String(255))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    category = db.Column(db.String(50))
    is_active = db.Column(db.Integer, default=1)
    menus = db.relationship("MenuItem", backref="store", lazy=True)

class MenuItem(db.Model):
    __tablename__ = "menu_items"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    price = db.Column(db.Numeric(10, 2))
    image = db.Column(db.String(255))
    store_id = db.Column(db.Integer, db.ForeignKey("stores.id"))

class Order(db.Model):
    __tablename__ = "orders"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    store_id = db.Column(db.Integer, db.ForeignKey("stores.id"))
    items_json = db.Column(db.Text, nullable=False)
    total_price = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(20), default="Pending")
    created_at = db.Column(db.DateTime, default=db.func.now())

class Payment(db.Model):
    __tablename__ = "payments"

    id = db.Column(db.Integer, primary_key=True)
    order_master_id = db.Column(
        db.Integer,
        db.ForeignKey("customer_order_master.id"),
        nullable=False
    )

    order_id = db.Column(db.String(30), nullable=False)   # ORD-XXX
    payer_name = db.Column(db.String(50), nullable=True) # split name
    method = db.Column(db.String(20))
    provider = db.Column(db.String(50))
    amount = db.Column(db.Numeric(10,2))
    status = db.Column(db.String(20), default="success")
    midtrans_order_id = db.Column(db.String(50), unique=True)
    paid_at = db.Column(db.DateTime)

# --- ORDER STATUS ---
@app.route("/orders/<order_id>/update-status", methods=["POST"])
def update_order_status(order_id):
    """
    Endpoint untuk update status order real-time dari halaman tracking (arive.js)
    """
    try:
        data = request.json
        new_status = data.get("status")
        
        if not new_status:
            return jsonify({"success": False, "error": "Status is required"}), 400

        # 1. Update status di tabel CustomerOrder (Detail Item)
        # Menggunakan .update() untuk mengubah semua baris item dengan order_id yang sama sekaligus
        updated_rows = db.session.query(CustomerOrder).filter_by(order_id=order_id).update(
            {"status_order": new_status},
            synchronize_session=False
        )
        
        # 2. Update status di tabel CustomerOrderMaster (Data Utama Order)
        # Ini penting agar jika halaman direfresh, status tetap tersimpan di master
        master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
        if master:
            master.status_order = new_status
            
        # Commit perubahan ke database
        db.session.commit()
        
        print(f"✅ Order {order_id} updated to: {new_status}")
        
        return jsonify({
            "success": True, 
            "message": f"Status updated to {new_status}",
            "updated_items": updated_rows
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error updating status: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# --- LOGIC JARAK ---
def get_distance(lat1, lon1, lat2, lon2):
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return "No"
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return round(R * c, 1)

class CustomerOrder(db.Model):
    __tablename__ = "customer_order"
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.String(30), nullable=False)
    customer = db.Column(db.String(50), nullable=False)
    date_order = db.Column(db.Date, nullable=False)
    product_ordered = db.Column(db.String(50), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    total_price = db.Column(db.Numeric(10, 0), nullable=False)
    status_order = db.Column(db.String(50), nullable=False)
    is_archived = db.Column(db.Boolean, default=False)

class CustomerOrderMaster(db.Model):
    __tablename__ = "customer_order_master"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.String(30), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    store_id = db.Column(db.Integer, db.ForeignKey("stores.id"))
    driver_id = db.Column(db.Integer)
    total_price = db.Column(db.Numeric(10,2))
    status_order = db.Column(db.String(30), default="WAITING_PAYMENT")
    is_split = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=db.func.now())

class CustomerOrderItem(db.Model):
    __tablename__ = "customer_order_items"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.String(30))
    menu_name = db.Column(db.String(100))
    qty = db.Column(db.Integer)
    price = db.Column(db.Numeric(10,2))

class OrderSplit(db.Model):
    __tablename__ = "order_split"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.String(30))
    person_name = db.Column(db.String(50))
    amount = db.Column(db.Numeric(10,2))
    is_paid = db.Column(db.Boolean, default=False)

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(success=False, error="Unauthorized"), 401
        return f(*args, **kwargs)
    return decorated

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371  # radius bumi (km)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = math.sin(dlat/2)**2 + \
        math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * \
        math.sin(dlon/2)**2

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def calculate_eta(distance_km, vehicle):
    speed = 30 if vehicle == "Bike" else 40  # km/jam
    return max(3, round((distance_km / speed) * 60))

def is_night_time(check_time=None):
    """Cek apakah waktu termasuk night delivery (22:00-06:00)"""
    if check_time is None:
        check_time = datetime.now()
    current_hour = check_time.hour
    return current_hour >= NIGHT_START_HOUR or current_hour < NIGHT_END_HOUR

@app.route("/api/night-delivery/check")
def check_night_delivery():
    """Endpoint untuk cek status night delivery saat ini"""
    now = datetime.now()
    is_night = is_night_time(now)
    
    return jsonify({
        "success": True,
        "current_time": now.strftime("%H:%M:%S"),
        "hour": now.hour,
        "is_night": is_night,
        "night_fee": NIGHT_DELIVERY_FEE if is_night else 0,
        "night_hours": f"{NIGHT_START_HOUR}:00 - {NIGHT_END_HOUR}:00"
    })

@app.route("/api/night-delivery/simulate", methods=["POST"])
def simulate_night_delivery():
    """Endpoint untuk simulasi/testing night delivery"""
    data = request.json
    hour = data.get("hour", datetime.now().hour)
    
    # Buat waktu simulasi
    simulated_time = datetime.now().replace(hour=hour % 24)
    is_night = is_night_time(simulated_time)
    
    return jsonify({
        "success": True,
        "simulated_hour": hour,
        "simulated_time": simulated_time.strftime("%H:%M:%S"),
        "is_night": is_night,
        "night_fee": NIGHT_DELIVERY_FEE if is_night else 0,
        "message": f"Simulated time {hour}:00 - Night delivery: {'YES' if is_night else 'NO'}"
    })

# --- RECOMENDED ---
@app.route("/api/recommendations", methods=["GET"])
@login_required
def get_recommendations():
    """Endpoint utama untuk rekomendasi"""
    try:
        # Ambil parameter
        lat = float(request.args.get('lat', -7.7956))  # Default Yogyakarta
        lon = float(request.args.get('lon', 110.3695))
        limit = int(request.args.get('limit', 6))
        
        user_id = session.get("user_id")
        
        if not user_id:
            return jsonify({
                "success": False,
                "message": "User not logged in",
                "recommendations": []
            })
        
        # Dapatkan rekomendasi
        recommendations = recommender.get_quick_recommendations(user_id, lat, lon)
        
        # Format response
        formatted_recs = []
        for rec in recommendations[:limit]:
            formatted_recs.append({
                "id": rec["id"],
                "name": rec["name"],
                "image": rec.get("logo") or "/static/assets/images/noimg.png",
                "category": rec.get("category", "Restoran"),
                "distance": f"{rec.get('distance', 5.0)} km",
                "rating": rec.get("rating", 4.0),
                "reason": rec.get("reason", "Direkomendasikan untuk Anda"),
                "match_score": rec.get("match_score", 70),
                "type": rec.get("type", "general"),
                "order_count": rec.get("order_count", 0)
            })
        
        # Cek apakah user punya riwayat
        user_history = recommender.get_user_order_history(user_id)
        
        return jsonify({
            "success": True,
            "recommendations": formatted_recs,
            "has_history": len(user_history) > 0,
            "total_orders": sum([h.order_count for h in user_history])
        })
        
    except Exception as e:
        print(f"Recommendation error: {e}")
        return jsonify({
            "success": False,
            "recommendations": [],
            "error": str(e)
        }), 500
        
@app.route("/api/recommendations/insights", methods=["GET"])
@login_required
def get_recommendation_insights():
    """Insight tentang rekomendasi"""
    user_id = session.get("user_id")
    
    if not user_id:
        return jsonify({"success": False})
    
    try:
        # Ambil data user
        order_history = recommender.get_user_order_history(user_id)
        top_menus = recommender.get_most_ordered_menus(user_id)
        similar_users = recommender.get_users_with_similar_taste(user_id)
        
        # Format insight
        insights = {
            "total_orders": sum([h.order_count for h in order_history]) if order_history else 0,
            "favorite_stores_count": len(order_history) if order_history else 0,
            "top_menus": [
                {
                    "name": m.menu_name,
                    "total_qty": m.total_qty,
                    "order_count": m.order_count
                } for m in top_menus[:3]
            ] if top_menus else [],
            "similar_users_count": len(similar_users)
        }
        
        return jsonify({
            "success": True,
            "insights": insights
        })
        
    except Exception as e:
        print(f"Insights error: {e}")
        return jsonify({"success": False, "error": str(e)})
    
# --- ROUTES HALAMAN ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/checkout")
def checkout_page():
    return render_template("checkout.html")

@app.route("/auth/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify(success=False, error="Email dan password wajib"), 400

    user = db.session.query(User).filter_by(email=email).first()
    if not user:
        return jsonify(success=False, error="Email tidak ditemukan"), 401

    if not check_password_hash(user.password, password):
        return jsonify(success=False, error="Password salah"), 401

    session["user_id"] = user.id

    return jsonify(
        success=True,
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email
        }
    )

@app.route("/auth/me")
def check_session():
    if "user_id" not in session:
        return jsonify(logged_in=False)

    user = db.session.get(User, session["user_id"])
    if not user:
        session.clear()
        return jsonify(logged_in=False)

    return jsonify(
        logged_in=True,
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email
        }
    )


@app.route("/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(success=True)

@app.route("/auth/register", methods=["POST"])
def register():
    data = request.json

    name = data.get("name")
    email = data.get("email")
    password = data.get("password")

    if not name or not email or not password:
        return jsonify({"success": False, "message": "Data tidak lengkap"}), 400

    # 🔥 VALIDASI FORMAT EMAIL
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        return jsonify({
            "success": False, 
            "message": "Format email tidak valid. Contoh: nama@gmail.com"
        }), 400

    # 🔥 VALIDASI PANJANG PASSWORD
    if len(password) < 6:
        return jsonify({
            "success": False,
            "message": "Password minimal 6 karakter"
        }), 400

    # 🔥 VALIDASI PANJANG NAMA
    if len(name) < 3:
        return jsonify({
            "success": False,
            "message": "Nama minimal 3 karakter"
        }), 400

    # Cek email sudah terdaftar
    existing_user = db.session.query(User).filter_by(email=email).first()
    if existing_user:
        return jsonify({"success": False, "message": "Email sudah terdaftar"}), 409

    # HASH PASSWORD
    hashed_password = generate_password_hash(password)

    new_user = User(
        name=name,
        email=email,
        password=hashed_password
    )

    try:
        db.session.add(new_user)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Registrasi berhasil"
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/orders/<order_id>/summary")
@login_required
def order_summary(order_id):
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return jsonify(success=False), 404

    # === SUBTOTAL ===
    items = CustomerOrderItem.query.filter_by(order_id=order_id).all()
    subtotal = sum(float(i.price) * i.qty for i in items)

    # === DRIVER & DISTANCE ===
    driver = None
    delivery_fee = 0
    eta = None

    if master.driver_id:
        result = db.session.execute(text("""
            SELECT 
                d.name,
                d.vehicle,
                d.latitude AS d_lat,
                d.longitude AS d_lon,
                s.latitude AS s_lat,
                s.longitude AS s_lon
            FROM drivers d
            JOIN stores s ON s.id = :store_id
            WHERE d.id = :driver_id
        """), {
            "store_id": master.store_id,
            "driver_id": master.driver_id
        }).mappings().fetchone()

        if result:
            distance = calculate_distance(
                result["d_lat"], result["d_lon"],
                result["s_lat"], result["s_lon"]
            )

            eta = calculate_eta(distance, result["vehicle"])

            delivery_fee = BASE_DELIVERY_FEE + (distance * FEE_PER_KM)

            driver = {
                "name": result["name"],
                "distance_km": round(distance, 1),
                "eta_minutes": eta
            }

    # === NIGHT DELIVERY - CEK WAKTU ORDER DIBUAT ===
    night_fee = 0
    if master.created_at:
        # Cek apakah order dibuat pada waktu night delivery
        order_time = master.created_at
        is_night = is_night_time(order_time)
        night_fee = NIGHT_DELIVERY_FEE if is_night else 0

    total_price = subtotal + delivery_fee + night_fee

    return jsonify(
        success=True,
        subtotal=int(subtotal),
        delivery_fee=int(delivery_fee),
        night_delivery_fee=int(night_fee),
        total_price=int(total_price),
        is_split=master.is_split,
        driver=driver,
        is_night=night_fee > 0
    )

@app.route("/orders/<order_id>/split", methods=["GET"])
@login_required
def get_order_split(order_id):
    splits = db.session.query(OrderSplit).filter_by(order_id=order_id).all()
    if not splits:
        return jsonify(success=False, error="No split bill"), 404

    return jsonify(
        success=True,
        split=[
            {
                "name": s.person_name,
                "amount": float(s.amount),
                "is_paid": s.is_paid
            }
            for s in splits
        ]
    )


# --- ROUTES API ---
@app.route("/orders/stores", methods=["GET"])
def get_stores():
    try:
        # Ambil parameter latitude dan longitude dari request
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
        
        # Ambil semua stores yang aktif
        stores = db.session.query(Store).filter_by(is_active=1).all()
        
        result = []
        for store in stores:
            # Hitung jarak
            distance = get_distance(lat, lon, store.latitude, store.longitude)
            
            # Tentukan rating acak untuk demo (bisa diganti dengan rating sebenarnya dari database)
            import random
            rating = round(random.uniform(3.5, 5.0), 1)
            
            # Tentukan promo acak (30% chance)
            promo = random.choice([True, False, False])
            
            result.append({
                "id": store.id,
                "name": store.name,
                "image": store.logo if store.logo else "/static/assets/images/noimg.png",
                "distance": f"{distance} km",
                "rating": rating,
                "promo": promo,
                "category": store.category if store.category else "Restoran"
            })
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Error in get_stores: {e}")
        return jsonify([]), 500

@app.route("/orders/stores/<int:store_id>/menu")
def get_menu(store_id):
    store = db.session.get(Store, store_id)
    if not store: return jsonify([])
    return jsonify([{"name": m.name, "price": float(m.price), "image": m.image} for m in store.menus])

@app.route("/orders/checkout", methods=["POST"])
@login_required
def checkout():
    data = request.json
    user_id = session["user_id"]

    order_id = f"ORD-{uuid.uuid4().hex[:10].upper()}"
    user = db.session.get(User, user_id)
    # ==========================
    # HITUNG SUBTOTAL ITEMS
    # ==========================
    subtotal = sum(
        item["price"] * item["qty"]
        for item in data["items"]
    )

    # ==========================
    # DELIVERY FEE
    # ==========================
    delivery_fee = 0
    if data.get("driver_id"):
        result = db.session.execute(text("""
            SELECT 
                d.latitude AS d_lat,
                d.longitude AS d_lon,
                s.latitude AS s_lat,
                s.longitude AS s_lon
            FROM drivers d
            JOIN stores s ON s.id = :store_id
            WHERE d.id = :driver_id
        """), {
            "store_id": data["store_id"],
            "driver_id": data["driver_id"]
        }).mappings().fetchone()

        if result:
            distance = calculate_distance(
                result["d_lat"], result["d_lon"],
                result["s_lat"], result["s_lon"]
            )
            delivery_fee = BASE_DELIVERY_FEE + (distance * FEE_PER_KM)

    # ==========================
    # NIGHT FEE
    # ==========================
    is_night = is_night_time()
    night_fee = NIGHT_DELIVERY_FEE if is_night else 0

    # ==========================
    # GRAND TOTAL
    # ==========================
    grand_total = subtotal + delivery_fee + night_fee

    # ==========================
    # MASTER ORDER
    # ==========================
    is_split = data.get("is_split", False)

    master = CustomerOrderMaster(
        order_id=order_id,
        user_id=user_id,
        store_id=data["store_id"],
        driver_id=data.get("driver_id"),
        total_price=grand_total,
        is_split=is_split,
        status_order="WAITING_SPLIT_PAYMENT" if is_split else "WAITING_PAYMENT"
    )
    db.session.add(master)

    # ==========================
    # ORDER ITEMS
    # ==========================
    for item in data["items"]:
        db.session.add(CustomerOrderItem(
            order_id=order_id,
            menu_name=item["menuName"],
            qty=item["qty"],
            price=item["price"]
        ))
        
    for item in data["items"]:
        # Hitung total per item
        item_total = item["price"] * item["qty"]
        
        # Insert ke tabel customer_order
        customer_order = CustomerOrder(
            order_id=order_id,
            customer=user.name,
            date_order=date.today(),
            product_ordered=item["menuName"],
            quantity=item["qty"],
            total_price=item_total,
            status_order="WAITING_SPLIT_PAYMENT" if is_split else "WAITING_PAYMENT",
            is_archived=False
        )
        db.session.add(customer_order)
        
    # ==========================
    # SPLIT BILL
    # ==========================
    if is_split:
        split_people = data.get("split_people", [])
        if not split_people:
            return jsonify(success=False, error="Split people empty"), 400
        
        total_people = len(split_people)
        subtotal_per_person = subtotal / total_people
        delivery_per_person = delivery_fee / total_people
        night_per_person = night_fee / total_people
        
        # gunakan amount sesuai payload frontend
        for p in split_people:
            if p.get("amount"):
                person_total = float(p["amount"])
            else:
                # Hitung otomatis termasuk night fee
                person_total = subtotal_per_person + delivery_per_person + night_per_person
            db.session.add(OrderSplit(
                order_id=order_id,
                person_name=p["name"],
                amount=float(person_total),
                is_paid=False
            ))

    db.session.commit()
    return jsonify(
        success=True, 
        order_id=order_id,
        is_night=is_night,
        night_fee=night_fee
    )

    
@app.route("/orders/<order_id>/driver")
@login_required
def get_order_driver(order_id):
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master or not master.driver_id:
        return jsonify(success=False), 404

    conn = getdb()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            d.name,
            d.vehicle,
            d.latitude,
            d.longitude,
            s.latitude AS store_lat,
            s.longitude AS store_lon
        FROM drivers d
        JOIN stores s ON s.id = %s
        WHERE d.id = %s
    """, (master.store_id, master.driver_id))

    driver = cursor.fetchone()
    cursor.close()
    conn.close()

    if not driver:
        return jsonify(success=False), 404

    distance = calculate_distance(
        driver["latitude"],
        driver["longitude"],
        driver["store_lat"],
        driver["store_lon"]
    )


    eta = calculate_eta(distance, driver["vehicle"])

    return jsonify(
        success=True,
        name=driver["name"],
        distance_km=round(distance, 1),
        eta_minutes=eta
    )



@driver_bp.route("/drivers", methods=["GET"])
def get_drivers():
    store_id = request.args.get("store_id")
    if not store_id:
        return jsonify([])

    conn = getdb()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT latitude, longitude
        FROM stores
        WHERE id = %s
    """, (store_id,))
    store = cursor.fetchone()

    if not store:
        return jsonify([])

    cursor.execute("""
        SELECT id, name, rating, vehicle, latitude, longitude
        FROM drivers
        WHERE is_active = 1
    """)
    drivers = cursor.fetchall()

    results = []
    for d in drivers:
        distance = calculate_distance(
            store["latitude"], store["longitude"],
            d["latitude"], d["longitude"]
        )
        eta = calculate_eta(distance, d["vehicle"])

        results.append({
            "id": d["id"],
            "name": d["name"],
            "rating": d["rating"],
            "vehicle": d["vehicle"],
            "distance_km": round(distance, 1),
            "eta_minutes": eta
        })

    cursor.close()
    conn.close()

    return jsonify(results)

@app.route("/orders/<order_id>")
def get_order_detail(order_id):
    orders = db.session.query(CustomerOrder).filter_by(order_id=order_id).all()

    if not orders:
        return jsonify(success=False), 404

    total = sum(o.total_price for o in orders)

    return jsonify(
        success=True,
        order_id=order_id,
        customer=orders[0].customer,
        status=orders[0].status_order,
        total_price=float(total),
        items=[
            {
                "name": o.product_ordered,
                "qty": o.quantity,
                "price": float(o.total_price)
            }
            for o in orders
        ]
    )


@app.route("/payment")
def payment_page():
    if "user_id" not in session:
        return redirect("/")

    order_id = request.args.get("order_id")
    if not order_id:
        return redirect("/")

    return render_template("payment.html", order_id=order_id)

@app.route("/orders/<order_id>/payment-info")
@login_required
def payment_info(order_id):
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return jsonify(success=False), 404

    response = {
        "success": True,
        "is_split": master.is_split,
        "total_price": float(master.total_price)
    }

    if master.is_split:
        splits = OrderSplit.query.filter_by(order_id=order_id).all()
        response["split"] = [{
            "name": s.person_name,
            "amount": float(s.amount),
            "is_paid": s.is_paid
        } for s in splits]

    return jsonify(response)




@app.route("/payments/confirm", methods=["POST"])
@login_required
def confirm_payment():
    data = request.json
    raw_order_id = data.get("order_id") # Contoh: "ORD-123|You|abc"
    method = data.get("method")
    provider = data.get("bank", "midtrans")
    payer_name = data.get("payer") # Nama pengirim dari JS

    if not raw_order_id:
        return jsonify(success=False, error="Order ID missing"), 400

    # 1. Ambil ID asli (buang embel-embel Midtrans setelah tanda '|')
    order_id = raw_order_id.split('|')[0]

    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return jsonify(success=False, error="Order master not found"), 404

    try:
        if master.is_split:
            # 2. Gunakan 'person_name' sesuai file SQL Anda
            split = OrderSplit.query.filter_by(
                order_id=order_id,
                person_name=payer_name  # <-- SESUAI TABEL SQL ANDA
            ).first()

            if not split:
                print(f"DEBUG: Payer {payer_name} not found in Order {order_id}")
                return jsonify(success=False, error="Split record not found"), 404

            if split.is_paid:
                return jsonify(success=True, message="Already paid")

            # Update status bayar orang tersebut
            split.is_paid = True
            db.session.flush()

            # 3. Cek apakah masih ada teman yang belum bayar
            unpaid_count = OrderSplit.query.filter_by(
                order_id=order_id,
                is_paid=False
            ).count()

            # Jika SEMUA lunas, buat record Payment & ubah status utama
            if unpaid_count == 0:
                total_amount = sum(float(s.amount) for s in OrderSplit.query.filter_by(order_id=order_id).all())
                
                payment = Payment(
                    order_master_id=master.id,
                    method=method,
                    provider=provider,
                    amount=total_amount,
                    status="success",
                    paid_at=datetime.now()
                )
                db.session.add(payment)
                master.status_order = "PREPARING"
            
            db.session.commit()
            return jsonify(success=True, split_paid=True)

        else:
            # PEMBAYARAN TUNGGAL
            payment = Payment(
                order_master_id=master.id,
                method=method,
                provider=provider,
                amount=master.total_price,
                status="success",
                paid_at=datetime.now()
            )
            db.session.add(payment)
            master.status_order = "PREPARING"
            db.session.commit()
            return jsonify(success=True)

    except Exception as e:
        db.session.rollback()
        print(f"❌ Error Confirm: {str(e)}")
        return jsonify(success=False, error=str(e)), 500

@app.route("/payments/midtrans-token", methods=["POST"])
@login_required
def midtrans_token():
    data = request.json
    order_id = data.get("order_id")
    payer_name = data.get("payer")  # split payer

    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return jsonify(success=False, error="Order not found"), 404

    # Default amount
    amount = float(master.total_price)

    # Jika split
    if master.is_split and payer_name:
        split = OrderSplit.query.filter_by(order_id=order_id, person_name=payer_name).first()
        if not split:
            return jsonify(success=False, error="Payer not found"), 404
        
        # Hitung delivery & night fee per orang
        total_people = OrderSplit.query.filter_by(order_id=order_id).count()
        per_person_delivery = float(master.total_price - sum([s.amount for s in OrderSplit.query.filter_by(order_id=order_id).all()])) / total_people
        # Misal master.total_price sudah termasuk delivery & night fee
        amount = float(split.amount) + per_person_delivery

    transaction_details = {
        "order_id": f"{order_id}-{payer_name}-{uuid.uuid4().hex[:6]}" if payer_name else f"{order_id}-{uuid.uuid4().hex[:6]}",
        "gross_amount": int(round(amount))
    }

    customer_details = {
        "first_name": payer_name or "User",
        "email": "user@example.com"
    }

    midtrans_order_id = f"{order_id}|{payer_name or 'FULL'}|{uuid.uuid4().hex[:6]}"

    params = {
        "transaction_details": {
            "order_id": midtrans_order_id,
            "gross_amount": int(round(amount))
        },
        "custom_field1": order_id,      # ORD-XXX
        "custom_field2": payer_name     # nama split / None
    }
    
    try:
        token = snap.create_transaction_token(params)
        return jsonify(success=True, token=token)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

@app.route("/orders/<order_id>/driver-pos")
def driver_position(order_id):
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master or not master.driver_id:
        return jsonify(success=False), 404

    driver = db.session.execute(text("""
        SELECT latitude, longitude FROM drivers WHERE id = :driver_id
    """), {"driver_id": master.driver_id}).mappings().first()

    return jsonify(success=True, lat=driver["latitude"], lon=driver["longitude"])


@app.route("/payments/midtrans-webhook", methods=["POST"])
def midtrans_webhook():
    data = request.json

    # ===============================
    # 1. VERIFIKASI SIGNATURE
    # ===============================
    SERVER_KEY = "Mid-server-1vyWJQ6aNqi7VBaNeLlj4Q35"

    raw_signature = (
        data.get("order_id", "") +
        data.get("status_code", "") +
        data.get("gross_amount", "") +
        SERVER_KEY
    )

    signature = hashlib.sha512(raw_signature.encode()).hexdigest()

    if signature != data.get("signature_key"):
        return "INVALID SIGNATURE", 403

    # ===============================
    # 2. CEK STATUS TRANSAKSI
    # ===============================
    transaction_status = data.get("transaction_status")

    if transaction_status not in ["settlement", "capture"]:
        return "IGNORED", 200

    # ===============================
    # 3. DATA MIDTRANS
    # ===============================
    midtrans_order_id = data.get("order_id")
    payment_type = data.get("payment_type")
    gross_amount = Decimal(data.get("gross_amount", "0"))

    order_id = data.get("custom_field1")   # ORD-XXX
    payer_name = data.get("custom_field2") # nama split / None

    # ===============================
    # 4. CARI MASTER ORDER
    # ===============================
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return "ORDER NOT FOUND", 404

    # ===============================
    # 5. PROVIDER
    # ===============================
    provider = payment_type

    if payment_type == "bank_transfer":
        provider = data.get("va_numbers", [{}])[0].get("bank")
    elif payment_type == "qris":
        provider = "qris"
    elif payment_type == "gopay":
        provider = "gopay"

    # ===============================
    # 6. ANTI DOUBLE INSERT
    # ===============================
    exists = db.session.query(Payment).filter_by(
        midtrans_order_id=midtrans_order_id
    ).first()

    if exists:
        return "ALREADY PROCESSED", 200

    # ===============================
    # 7. INSERT PAYMENT
    # ===============================
    payment = Payment(
        order_master_id=master.id,
        order_id=order_id,
        payer_name=payer_name,
        method=payment_type,
        provider=provider,
        amount=gross_amount,
        status="success",
        midtrans_order_id=midtrans_order_id,
        paid_at=datetime.now()
    )
    db.session.add(payment)

    # ===============================
    # 8. SPLIT BILL LOGIC
    # ===============================
    if master.is_split and payer_name:
        split = db.session.query(OrderSplit).filter_by(
            order_id=order_id,
            person_name=payer_name
        ).first()

        if not split:
            return "SPLIT NOT FOUND", 404

        split.is_paid = True
        db.session.add(split)

        # cek apakah semua sudah bayar
        unpaid = db.session.query(OrderSplit).filter_by(
            order_id=order_id,
            is_paid=False
        ).count()

        if unpaid == 0:
            master.status_order = "PREPARING"

    else:
        # NON SPLIT
        master.status_order = "PREPARING"

    db.session.commit()
    return "OK", 200

@app.route("/orders/<order_id>/arive-driver")
@login_required
def arive_driver(order_id):
    """Get driver and order info for tracking"""
    # DARI: master = CustomerOrderMaster.query.filter_by(order_id=order_id).first()
    # MENJADI:
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    
    if not master:
        return jsonify(success=False, error="Order not found"), 404
    
    if not master.driver_id:
        return jsonify(success=False, error="Driver not assigned"), 404

    # Get driver info with avatar
    driver = db.session.execute(text("""
        SELECT id, name, vehicle, latitude, longitude
        FROM drivers
        WHERE id = :driver_id
    """), {"driver_id": master.driver_id}).mappings().first()

    if not driver:
        return jsonify(success=False, error="Driver not found"), 404

    # Get store info - GANTI DI SINI
    # DARI: store = Store.query.get(master.store_id)
    # MENJADI:
    store = db.session.get(Store, master.store_id)
    
    return jsonify(
        success=True,
        order_id=order_id,
        driver={
            "id": driver["id"],
            "name": driver["name"],
            "vehicle": driver["vehicle"],
            "lat": float(driver["latitude"]),
            "lon": float(driver["longitude"]),
            "avatar": "https://cdn-icons-png.flaticon.com/512/3135/3135715.png"
        },
        store={
            "id": store.id if store else None,
            "name": store.name if store else "Unknown Store",
            "lat": store.latitude if store else None,
            "lon": store.longitude if store else None
        },
        status=master.status_order
    )

@app.route("/arive")
@login_required
def arive_page():
    order_id = request.args.get("order_id")
    if not order_id:
        return redirect("/")
    
    # Cek apakah order ada dan sudah dibayar
    master = db.session.query(CustomerOrderMaster).filter_by(order_id=order_id).first()
    if not master:
        return redirect("/")
    
    # Cek status pembayaran
    if master.is_split:
        # Untuk split bill, cek apakah semua sudah bayar
        unpaid_splits = db.session.query(OrderSplit).filter_by(
            order_id=order_id,
            is_paid=False
        ).count()
        
        if unpaid_splits > 0:
            # Belum semua bayar, redirect kembali ke payment
            return redirect(f"/payment?order_id={order_id}")
    
    # Jika sampai sini, bisa render arive page
    return render_template("arive.html", order_id=order_id)

app.register_blueprint(driver_bp)

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)





