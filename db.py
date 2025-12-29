import pymysql

def getdb():
    return pymysql.connect(
        host="easyfood.mysql.database.azure.com",
        user="admin_jawa",
        password="admin_jawa1",
        database="easyfood_db",
        cursorclass=pymysql.cursors.DictCursor
    )
