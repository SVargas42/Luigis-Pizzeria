import mariadb from 'mariadb';
const objConnection=await mariadb.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis'});
try{
 await objConnection.query('DELETE FROM account_sessions WHERE expires_at<UTC_TIMESTAMP()');
 await objConnection.query('DELETE FROM account_actions WHERE expires_at<UTC_TIMESTAMP()');
 await objConnection.query('DELETE FROM account_throttles WHERE expires_at<UTC_TIMESTAMP()');
 // Unsent verification/reset messages contain one-time links and expire after one hour.
 await objConnection.query("UPDATE account_mail SET message='',attempts=10 WHERE sent_at IS NULL AND purpose='account' AND created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR)");
 await objConnection.query('DELETE FROM account_mail WHERE sent_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)');
 console.log('Expired account credentials and delivered mail records cleaned.');
}finally{await objConnection.end();}
