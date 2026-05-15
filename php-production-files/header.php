	<style type="text/css">
   #block-under-window-j{
		position: fixed;
		margin-left:-148px;
		width:100%;
		height:100%;
		background: #000;
		opacity: 0.6;
		filter: alpha(opacity=60); /* For IE8 and earlier */
		z-index:2000;
		display:none;

	}
	.pie-placeholder-cuenta {
		float:left;
		width: 150px;
		height: 150px;
		margin:0;
		margin-right:6px;
		margin-top:1px;
		font-size: 14px;
		line-height: 1.2em;
		padding:0;
	}
   .tip{
		width:300px;
		padding: 10px;
		display: none;
		position: absolute;
		text-align:left;
		border: 1px solid #D5D5D5;
		background: #DDDDDD;
		background: linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -o-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -ms-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -moz-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		background: -webkit-linear-gradient(#f6f6f6 0, #DDDDDD 50px);
		box-shadow: 0 6px 15px rgba(0,0,0,0.40);
		-o-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-ms-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-moz-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-webkit-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		z-index:1000;
   }
   
   .outerCuenta{
		width:440px;
				
		position: fixed;
		display:none;
		z-index: 3000;
		border: 1px solid #D5D5D5;
		background: #DDDDDD;
		background: linear-gradient(#f6f6f6 0, #DDDDDD 95px);
		background: -o-linear-gradient(#f6f6f6 0, #DDDDDD 95px);
		background: -ms-linear-gradient(#f6f6f6 0, #DDDDDD 95px);
		background: -moz-linear-gradient(#f6f6f6 0, #DDDDDD 95px);
		background: -webkit-linear-gradient(#f6f6f6 0, #DDDDDD 95px);
		box-shadow: 0 6px 15px rgba(0,0,0,0.40);
		-o-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-ms-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-moz-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
		-webkit-box-shadow: 0 6px 15px rgba(0,0,0,0.3);
	}
</style>
	
	<link rel="shortcut icon" href="favicon.ico">
	<link rel="icon" type="image/gif" href="favicon.gif">
	<link rel="stylesheet" href="css/thickbox.css" type="text/css" media="screen" />
    <link href="site_pop_up.css" rel="stylesheet" type="text/css" />
	<!-- CSS CHAT-->
	<link type="text/css" rel="stylesheet" media="all" href="chat/css/chat.css" />
	
	<link href="css/style_button.css" rel="stylesheet" type="text/css" />
		
    <!-- CSS ALERTAS-->
	<link type="text/css" rel="stylesheet" media="all" href="css/style_header_alertas.css" />
	
	<!-- jQuery -->
	<script src="js/jquery-1.7.2.min.js"></script>	
    <!-- jQuery UI -->
    <script src="js/jquery-ui-1.8.21.custom.min.js"></script>
     <!-- <script src="chat/js/ion.sound/js/ion.sound.js"></script> -->
	 
	 <!-- data table plugin -->
     <script src='js/jquery.quicksearch.js'></script>
		
	<script language="javascript" type="text/javascript" src="js/grafica/jquery.flot.js"></script>
	<script language="javascript" type="text/javascript" src="js/grafica/jquery.flot.pie.js"></script>
		
	<script type="text/javascript">
			var $j = jQuery.noConflict();
	</script>
	<script type="text/javascript" src="js/thickbox.js"></script>
	
	<!-- JS HEADER ALERTAS -->
	<script type="text/javascript" src="js/functions_header_alertas.js"></script>
	
	<!-- JS CHAT -->
	<!-- <script type="text/javascript" src="chat/js/ajax/envios_ajax.js"></script>
	<script type="text/javascript" src="chat/js/chat.js"></script> -->
	
	<!-- END JS CHAT-->
	<!-- Incluir libreria modales (biro) -->
	<script src="sweetAlert/sweetAlert.min.js"></script>
	<link href="sweetAlert/sweetAlert.css" rel="stylesheet">

	<!-- Incluir Cuenta corriente (biro)-->
	<!-- funciones del boton "ver presupuesto" -->
	<script language="JavaScript" src="./setup/actions.js"></script>
	<!-- script -->
	<script type="module" src="./cuenta_corriente/cuenta_corriente_pacientes.js"></script>


	<!-- Incluir Nuevo Presupuesto (biro) -->
	<!-- <script type="module" src="./nuevo_presupuesto/nuevo_presupuesto.js"></script> -->
	<!-- <script type="module" src="libro_iva/exportToExcel.js"></script> -->
	<!-- Incluir Libro IVA (biro) -->
	<!-- <script type="module" src="libro_iva/libro_iva.js"></script> -->
	
	
	
	<script language="JavaScript">	
		
		$j(document).ready(function() {
			
			// Habilta alertas visitas
			if( $j("#alert_visitas").length )
			{
				setInterval( function() {
					getNotificacionAlerta( 'bot_ap' , 'alert_visitas' );
				}, 60000);
			}
			// Habilta alertas online
			if( $j("#alert_online").length )
			{
				setInterval( function() {

					getNotificacionAlerta( 'bot_to' , 'alert_online' );
				}, 60000);
			}
			// Habilta alertas autogestion
			if( $j("#alert_autogestion").length )
			{
				setInterval( function() {
					getNotificacionAlerta( 'bot_a' , 'alert_autogestion' );
				
				}, 10000);
			}
			
			//CHAT FUNCIONES DE EJECUCION
			// var device = navigator.userAgent
			// if (device.match(/Iphone/i)|| device.match(/Ipod/i)|| device.match(/Android/i)|| device.match(/J2ME/i)|| device.match(/BlackBerry/i)|| device.match(/iPhone|iPad|iPod/i)|| device.match(/Opera Mini/i)|| device.match(/IEMobile/i)|| device.match(/Mobile/i)|| device.match(/Windows Phone/i)|| device.match(/windows mobile/i)|| device.match(/windows ce/i)|| device.match(/webOS/i)|| device.match(/palm/i)|| device.match(/bada/i)|| device.match(/series60/i)|| device.match(/nokia/i)|| device.match(/symbian/i)|| device.match(/HTC/i))
 			// { }else{
			// 	getUsersChat( 0 );
			// }
			
			// ion.sound({
			// 	sounds: [
			// 		{name: "notification_A"},
			// 		{name: "notification_B"},
			// 		{name: "notification_C"},
			// 		{name: "notification_D"},
			// 		{name: "notification_E"}
			// 	],
			// 	path: "chat/sounds/",
			// 	preload: true,
			// 	volume: 1.0
			// });
	
			
			/*
			 * Accesos rapidos dentro del sistema raiz
			 */
			window.addEventListener("keydown",function (e) 
			{
				
				var element = window.location.href.split("/");;
					
				
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 70))
				{
					if( $("#search").length > 0 ) 
					{
						e.preventDefault();
						$('#search').focus();
					}
					else 
					{			  		
						console.log("Default Ctrl F");
						return true;
					}
				}
				
				/* redireccion a la agenda  Ctrl P */
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 80))
				{
		
					e.preventDefault();
					window.location.href = "pacientes_home.php";
					
				}
				
				/* redireccion a la admisiones Ctrl A */
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 65))
				{
					
					e.preventDefault();
					window.location.href = "tvd_home.php";
				}
					

				
				/* redireccion a busqueda de pacientes Ctrol B */
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 66))
				{

						e.preventDefault();
						window.location.href = "pacientes.php";
					
				}
				
				/* Hostory Back Left */
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 37))
				{

						e.preventDefault();
						window.history.go(-1);
					
				}
				
				/* Hostory Back Right */
				if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 39))
				{

						e.preventDefault();
						window.history.go(+1);
					
				}
			});
			
		});
		
		
		
		function mostrarHelp(elemento,tip,titulo,descripcion){
	
			$j('#tips').html("<div id="+tip+" class='tip'><div style=' float:left; clear:none;'><img src='images/grales/icon-help.png' style='width:32px;'/></div><div style='width:auto; padding-left:15px; padding-top:5px; font-weight:bold; float:left; clear:none;  font-family: Arial, Helvetica Neue, Helvetica, sans-serif; font-size:14px;'>"+titulo+"</div><div style=\"float:left; width:100%; border-top:1px solid #7DC0D1; margin-top:5px;\"></div><div style='float:left; margin-top:10px; clear:both;  font-style: italic; font-family: Arial, Helvetica Neue, Helvetica, sans-serif; font-size:13px;'>"+descripcion+"</div><div style='float:left; margin-top:10px; clear:both; font-weight:700; font-family: Arial, Helvetica Neue, Helvetica, sans-serif; font-size:11px;'>Hacer Click para ingresar en el tutorial TREELAN.</div></div>");
			var posicion = $j('#'+elemento).offset();
			$j('#'+tip).css("left", posicion.left + 20);
			$j('#'+tip).css("top", posicion.top );
			$j('#'+tip).css("display", "block");
		}
		
		function ocultarHelp(tip){			
			$j('#'+tip).css("display", "none");
			$j('#tips').html("");
		}
		
		
		function mostrarNota(elemento,tip,titulo,descripcion){
	
			$j('#tips').html("<div id="+tip+" class='tip'><div style=' float:left; clear:none;'><img src='images/grales/actions/icon-info.png' style='width:32px;'/></div><div style='width:auto; padding-left:10px; padding-top:7px; font-weight:bold; float:left; clear:none;  font-family: Arial, Helvetica Neue, Helvetica, sans-serif; font-size:14px;'>"+titulo+"</div><div style=\"float:left; width:100%; border-top:1px solid #7DC0D1; margin-top:5px;\"></div><div style='float:left; margin-top:10px; clear:both;  font-style: italic; font-family: Arial, Helvetica Neue, Helvetica, sans-serif; font-size:13px;'>"+descripcion+"</div></div>");
			var posicion = $j('#'+elemento).offset();
			$j('#'+tip).css("left", posicion.left + 70);
			$j('#'+tip).css("top", posicion.top );
			$j('#'+tip).css("display", "block");
		}
		
		function ocultarNota(tip){			
			$j('#'+tip).css("display", "none");
			$j('#tips').html("");
		}
		
		function viewCuenta(id){
	
			blockUnderWindowJ();
			openWindowJ('.outerCuenta','#wrap1',25,-300);
			var parametros = {
				"id": id
			};
			
			var  	content_cuenta = '<div id="graph_consumo" class="pie-placeholder-cuenta"></div>';
						content_cuenta += '<span  style="float:left; position:absolute; width:100px;  left:25px; top:155px; font-family: Arial, Helvetica, Sans Serif; font-size:20px; font-weight:700; color:#4B647E; text-shadow: 0.1em 0.1em #ccc;">';
						content_cuenta += '<span id="porcentaje_consumido"></span>';
						content_cuenta += '<span style="font-size:14px;">%</span>';
						content_cuenta += '</span>';
						content_cuenta += '<span style="float:left; clear:none; padding-left:10px; padding-top:20px; font-size:12px;  font-family: Arial, Helvetica, Sans Serif; font-size:20px; ">';
						content_cuenta += '<span style="float:left; clear:both; font-size:13px; color:#616161;">Cantidad de Estudios/Imagenes: ';
						content_cuenta += '<span style="font-weight:700; color:#4B647E;"><span id="cantidad_estudios" ></span></span>';
						content_cuenta += ' </span>';
						content_cuenta += '<span style="float:left; padding-top:10px;  clear:both; font-size:13px; color:#616161;">';
						content_cuenta += '<span style="float:left; width:70px; text-align:left;">Espacio: </span>';
						content_cuenta += '<span style="font-weight:700; color:#4B647E; float:left; width:70px; text-align:right;"><span id="espacio_otorgado" ></span> MB</span>';
						content_cuenta += ' </span>';
						content_cuenta += '<span style="float:left; padding-top:5px; clear:both; font-size:13px; color:#616161;">';
						content_cuenta += '<span style="float:left; width:70px; text-align:left;">Consumo: </span>';
						content_cuenta += '<span style="font-weight:700; color:#4B647E; float:left; width:70px; text-align:right;"><span id="espacio_consumido" ></span> MB</span>';
						content_cuenta += ' </span>';
						content_cuenta += '<span style="float:left; padding-top:5px; clear:both; font-size:13px; color:#616161;">';
						content_cuenta += '<span style="float:left; width:70px; text-align:left;">Disponible: </span>';
						content_cuenta += '<span style="font-weight:700; color:#4B647E; float:left; width:70px; text-align:right;"><span id="espacio_disponible" ></span> MB</span>';
						content_cuenta += ' </span>';
						content_cuenta += '</span>';
			
			
			
			$j.ajax({
				url: 'community/treelan_cuenta_consulta.php',
				type: 'POST', // Send post data
				data: parametros,
				beforeSend: function () {
					$j('#loading').html('<img src="images/loading_cuentas.gif" width="25px;" />');
					$j('#cuenta_treelan').html('<span style="float:left; padding-left:190px; font-family:Arial,  Helvetica, Sans Serif; color:#616161; font-size:13px;  padding-top:50px; padding-bottom:50px;">Cargando..</span>');
				},				
				dataType: "json", // Set the data type so jQuery can parse it for you
				success: function (freshevents) {
					
					$j("#cuenta_treelan").empty();
					$j('#loading').empty();
					$j("#cuenta_treelan").html(content_cuenta);
					
					graphConsumo(freshevents[0],freshevents[1],freshevents[2],freshevents[3],freshevents[4],freshevents[5]);
					
				}
			}).done(function(){
				
			});
	
			
			
		}
		
		function graphConsumo(data,porcent_consumido,cantidad_estudios,espacio_otorgado,espacio_consumido,espacio_disponible){
			
			
			$j.plot('#graph_consumo', data, {
				series: {
					pie: { 
						show: true,
						radius: 0.8,
						innerRadius: 0.4,
						opacity:0.5,
						label: {
							show: false			
						},
						stroke: {
							width: 1,
							color: '#DDD'
						}
					}
				},
				legend: {
					show: false
				}
			});
			$j('#porcentaje_consumido').html(porcent_consumido);
			$j('#cantidad_estudios').html(cantidad_estudios);
			
			$j('#espacio_otorgado').html(espacio_otorgado);
			$j('#espacio_consumido').html(espacio_consumido);
			$j('#espacio_disponible').html(espacio_disponible);
			
			
			
		}
		
		function changeTabs(tabs){
			var tabs_old = $j('#tabs').val();
			
			/* Quita active tabs del actual */
			$j("#tabs_"+tabs_old).removeClass('active_tabs');			
			$j("#"+tabs_old).removeClass('tabs_active');
			$j("#"+tabs_old).addClass('tabs_desactive');
			
			/* Agrego nueva tabs active */
			$j('#tabs').val(tabs);
			
			$j("#tabs_"+tabs).addClass('active_tabs');
			
			$j("#"+tabs).removeClass('tabs_desactive');
			$j("#"+tabs).addClass('tabs_active');
		}
		
		/* Bloquea contenido por debajo de la ventana emergente */
		function blockUnderWindowJ(){
			$j('#block-under-window-j').css({display:"block"});
		}
		/* Desbloquea contenido por debajo de la ventana emergente */
		function unblockUnderWindowJ(){
			$j('#block-under-window-j').css({display:"none"});
		}
		

		/* Abre ventana emergente */
		function openWindowJ(content_window,content_position,ptop,pleft){
			var offset = $j(content_position).offset();

			var topOffset = offset.top + ptop;
			var leftOffset = offset.left - pleft;
			$j(content_window).css({top: topOffset, left: leftOffset });
			$j(content_window).draggable();
			//$(".outerWindowPacientes ").resizable();
			//$(content_window).css({display:"block"});
			$j(content_window).delay( 100 ).fadeIn( 100 );
		}
		/* Cierra ventana emergenta*/
		function closeWindowJ(content_window,content_elemento){
			unblockUnderWindowJ();
			$j(content_window).css({display:"none"});
			$j(content_elemento).html('');
			
		}
		
		
		function fecha_numeros(){
			var date = new Date();
			var dia  = date.getDay();
			var mes  = date.getMonth();
			var year = date.getFullYear();
			var fecha_completa = dia+"/"+mes+"/"+year
		}
		function date() {
		   date = new Date();
		   var day_of_week_number = date.getDay();
		   var day_of_month = date.getDate();
		   var month_number = date.getMonth();
		   var year = date.getFullYear();
		   var day_of_week = '';
		   var month = ''

		   if(month_number == 0){month = 'Enero';}
		   if(month_number == 1){month = 'Febrero';}
		   if(month_number == 2){month = 'Marzo';}
		   if(month_number == 3){month = 'Abril';}
		   if(month_number == 4){month = 'Mayo';}
		   if(month_number == 5){month = 'Junio';}
		   if(month_number == 6){month = 'Julio';}
		   if(month_number == 7){month = 'Agosto';} 
		   if(month_number == 8){month = 'Septiembre';}
		   if(month_number == 9){month = 'Octubre';}
		   if(month_number == 10){month = 'Noviembre';}
		   if(month_number == 11){month ='Diciembre';}


		   if(day_of_week_number == 0){day_of_week = '<b>Domingo</b>';}
		   if(day_of_week_number == 1){day_of_week = '<b>Lunes</b>';}
		   if(day_of_week_number == 2){day_of_week = '<b>Martes</b>';}
		   if(day_of_week_number == 3){day_of_week = '<b>Mi&eacute;rcoles</b>';}
		   if(day_of_week_number == 4){day_of_week = '<b>Jueves</b>';}
		   if(day_of_week_number == 5){day_of_week = '<b>Viernes</b>';}
		   if(day_of_week_number == 6){day_of_week = '<b>S&aacute;bado</b>';}


		   var date_to_show = day_of_week+ ', ' + day_of_month + ' de ' + month + ' de ' + year;

		  document.write(date_to_show);
		}
		
	//-->
	</script>
	
<?PHP
//# INICIO BLOQUEO DE PAGINAS #//

require_once('unblok_pages.php');

//# FIN BLOQUEO DE PAGINAS #//


		$Mlogo = "SELECT * FROM sedes WHERE Id = '$data_user_in[4]'";
		$MlogoRS = mysql_query($Mlogo);
		$logo = mysql_fetch_array($MlogoRS); 
		if ($curso['Root_Image']!==""){
			$Foto_User = "$curso[Root_Image]";
		}else{
			$Foto_User = "imagenes/users/foto_user.png";
		}
		
		/* Verifico cantidad de caracteres del nombre de usuario */
		$user_name =  $data_user_in[3].', '. $data_user_in[2];
		$user_name = ( strlen (  $user_name  )  > 25 ) ? '<span title="'.$user_name.'">'.substr( $user_name , 0, 25).'...</span>' :   $user_name ; // nombre usuario
		$user_sede = ( strlen (  $data_user_in[5]  )  > 10 )  ? '<span title="'.$data_user_in[5].'">'.substr( $data_user_in[5] , 0, 10).'...</span>' :   $data_user_in[5] ;  // nombre de sede

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET DE NOTIFICACIONES - Panel de Atencion al Paciente
// ═══════════════════════════════════════════════════════════════════════════════
$vercel_bot_url = 'https://chatbot-v1-12.vercel.app';
$bot_base_secret = '3x0nTh31sland';

// Obtener cliente_id
$result_widget = mysql_query("SELECT Id FROM Cliente_Datos LIMIT 1");
$row_widget = mysql_fetch_assoc($result_widget);
$cliente_id_widget = $row_widget['Id'];

// Generar secreto derivado
$secret_widget = hash('sha256', $bot_base_secret . $cliente_id_widget);

// Generar token SSO para el widget
$ip_widget = $_SERVER['REMOTE_ADDR'];
$user_agent_widget = $_SERVER['HTTP_USER_AGENT'];
$fingerprint_widget = hash('sha256', $ip_widget . $user_agent_widget);

$payload_widget = base64_encode(json_encode([
    'cliente_id'  => $cliente_id_widget,
    'usuario_id'  => $data_user_in[0],
    'apellido'    => $data_user_in[2],
    'nombre'      => $data_user_in[3],
    'fingerprint' => $fingerprint_widget,
    'iat'         => time(),
    'exp'         => time() + 86400,
    'nonce'       => bin2hex(openssl_random_pseudo_bytes(8))
]));

$signature_widget = hash_hmac('sha256', $payload_widget, $secret_widget);
$sso_token_widget = $payload_widget . '.' . $signature_widget;
// ═══════════════════════════════════════════════════════════════════════════════
		
	?>

	<div id="block-under-window-j"></div>
	<table align="center" height="75" width="1054" border="0" cellpadding="0" cellspacing="0" style="background-image:url(images/header/fdo_gral.jpg); background-repeat:no-repeat">
		<tr>
			<td align="left" width="140" height="56">&nbsp;</td>
			<td align="left" width="246" height="30" class="txt_hora_12" style="padding-top:26px" >
				<script>document.write = date()</script>
				
				<?PHP include('header_alertas.php');  ?>
				
			</td>
			<td align="center" width="212" height="39" style="padding:17px 0px 0px 0px"><img src="<?PHP echo "$logo[Image_Root_Encabezado]" ?>" /></td>
			<td width="406" height="56" align="right"  >
				<?PHP include('header_session.php');  ?>
			</td>
		</tr>
	</table>
	<!-- MENU -->
	<table align="center" width="900" border="0" cellpadding="0" cellspacing="0">
		<tr>
			<td width="900" height="28" bgcolor="#d9d9d9">
			<?PHP
				echo "<ul id=\"navbar\" class='navbar'>";
				$PRO = "SELECT * from tls_proceso ORDER BY Orden";
				$PROrs = mysql_query($PRO);
					
				while ($Proceso = mysql_fetch_array($PROrs)){
					$PER = "SELECT tls_sub_procesos.Id, tls_sub_procesos.Nombre, tls_sub_procesos.Proceso_Id, tls_sub_procesos.Link , tls_sub_procesos.Acceskey from tls_sub_procesos, tls_permisos where tls_permisos.Usuario_Id='$data_user_in[0]' AND tls_permisos.Proceso_Id='$Proceso[Id]' AND tls_sub_procesos.Id=tls_permisos.Sub_Proceso_Id ORDER BY tls_sub_procesos.Orden";
					$PERrs = mysql_query($PER) or die(mysql_error());
					$Total_Permisos = mysql_num_rows($PERrs);
					if ($Total_Permisos > 0){
						
						echo "<li><a href=\"$Proceso[Link]\" class=\"menu_pal\">$Proceso[Nombre]</a><ul>";
						//Contador de subprocesos
						$s = 0;
						while (list($Sub_Proceso_Id,$Sub_Proceso_Nombre,$Proceso_Id,$Sub_Proceso_Link,$Sub_Proceso_Acceskey) = mysql_fetch_row($PERrs)){

							// BOTON DE AYUDA
							$SHsql = "SELECT * FROM tutorial_subindice WHERE Id_Subproceso='$Sub_Proceso_Id'";
							$SHRsql = mysql_query($SHsql) or die(mysql_error());
							$existe_help = mysql_num_rows($SHRsql);
							if($existe_help){
								$help = mysql_fetch_assoc($SHRsql);
								$boton_help = "<img src=\"images/grales/icon-help.png\" style=\"width:18px;\" />";
								$boton_help_link = "<a  href=\"treelan_help.php?id=".$help['Id']."&title_indice=".$Proceso['Nombre']."&title_subindice=".$help['Titulo']."\" target='_BLACK'  onMouseOver=\"mostrarHelp('".$Proceso_Id."-".$s."','tip_view','".$help['Titulo']."','".$help['Descripcion']."')\" onMouseOut=\"ocultarHelp('tip_view')\" style=\"float:rigth; width:auto;height:20px;\" ><div id=\"$Proceso_Id-$s\" style=\"padding-top:1px; margin-left:-5px;\">$boton_help</div></a>";
							}else{
								$boton_help_link=  "<a style=\"float:rigth; width:auto;height:20px;\"></a>";
							}
							echo "<li >
										<div style=\"width:10em; float:left; clear:none;\">
											<a href=\"$Sub_Proceso_Link\" accesskey=\"$Sub_Proceso_Acceskey\"  class=\"menu_pal\" >$Sub_Proceso_Nombre</a>	
										</div>
										<div style=\"width:1.5em; height:20px; float:left; clear:none;\">
											$boton_help_link									
										</div>											
										</li>";
							//echo "&nbsp;&nbsp;&nbsp;$Sub_Proceso[Nombre] - $Sub_Proceso[Link] <br>";
							$s++;
						}
						echo"</ul></li>";
						//Incremento de subproceso;
						
					}
				}
				echo '
					<li>
						<a href="treelan_help.php" class="menu_pal">Ayuda</a>
						<ul>
							<li>
								<div style="width:10em; float:left; clear:none;">
									<a href="treelan_help.php?h=1" accesskey="" class="menu_pal">Tutorial de Treelan</a>	
								</div>
                            </li>
						</ul>
					</li>
				';
				echo"</ul>";
			?>
			</td>
		</tr>
		<tr>
			<td width="900"  valign="top">
			<?PHP 
				$Usuario_Id="$data_user_in[0]";
				$Proceso_Id="$Proceso_Padre";
				$PER = "SELECT tls_sub_procesos.Id, tls_sub_procesos.Nombre, tls_sub_procesos.Proceso_Id, tls_sub_procesos.ImageRootSubMenu, tls_sub_procesos.Link FROM tls_sub_procesos, tls_permisos WHERE tls_permisos.Usuario_Id='$Usuario_Id' AND tls_permisos.Proceso_Id='$Proceso_Id' AND tls_sub_procesos.Id=tls_permisos.Sub_Proceso_Id ORDER BY tls_sub_procesos.Orden";
				$PERrs = mysql_query($PER) or die(mysql_error());
				$Total_Permisos = mysql_num_rows($PERrs);
				if ($Total_Permisos > 0){	
					echo "<table width=\"100%\"  height=\"46\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" background=\"images/bot_icon/bot_icon_fdo.jpg\"><tr>";
					while (list($Sub_Proceso_Id,$Sub_Proceso_Nombre,$Proceso_Id,$Sub_Proceso_ImageRoot,$Sub_Proceso_Link) = mysql_fetch_row($PERrs)){
						echo "<td width=\"48\" height=\"46\" align=\"center\" valign=\"middle\"><a href=\"$Sub_Proceso_Link\" ><img src=\"$Sub_Proceso_ImageRoot\" alt=\"$Sub_Proceso_Nombre\" title=\"$Sub_Proceso_Nombre\" name=\"Image11\" width=\"32\" style=\"margin-top:auto;\" border=\"0\" id=\"Image11\" /></a></td>
							<td width=\"2\" valign=\"top\" background=\"images/bot_icon/bot_icon_separador.jpg\"></td>";
					}
					echo "<td width=\"450\" align=\"right\" valign=\"top\"><img src=\"images/bot_icon/bot_icon_der.jpg\" width=\"8\" height=\"46\" /></td></tr></table>";
				}
			?>
			</td>
		</tr>
	</table>
	<div id="block-under-window"></div>	
	
	
	<div id="tips"></div>
	
	
	<!-- WINDOW CHAT -->
	<!-- END WINDOW CHAT -->
	<!-- WINDOW CHAT -->
	<!-- <div id="listaChat" class="listaChat">
			<a href="javascript:void(0)" onclick="toggleChatLista('listaChat');">
				<div class="listaChatHead">
					<div class="listaChatTitle">Contactos Chat</div>
					<div class="listaChatOptions">
						<a href="javascript:void(0)" onclick="toggleChatLista('listaChat');">-</a>
					</div>
				</div>
			</a>
			<div class="listaChatContent" style="opacity: 1; margin:0px; padding:0px; float:left; clear:none;">
					<input type="text" id="search_contactos"  placeholder="Buscar Contactos..." style="width:100%; border:0px; color:#BCBCBC; font-size:12; text-indent:3px; padding-top:5px; padding-bottom:5px;" />

			</div>
			<div id="listaChatContent" class="listaChatContent"></div>		
	</div> -->
	
 
